import { promises as fs } from 'fs'
import { FileHandle } from 'fs/promises'
import * as crypto from 'crypto'
import * as path from 'path'

type NodeErrorWithCode = Error & { code?: string }

type StoreFileContent = string | Buffer

type CorruptStoreArgs<TFileContent extends StoreFileContent> = {
    filePath: string
    raw: TFileContent
    backupPath: string
}

type MutexFileStoreOptions<T, TFileContent extends StoreFileContent> = {
    filePath: string
    initialValue: () => T
    lockTimeoutMs?: number
    lockRetryDelayMs?: number
    onCorrupt?: (args: CorruptStoreArgs<TFileContent>) => void
}

class AsyncMutex {
    private chain: Promise<void> = Promise.resolve()

    public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        const previous = this.chain

        let release: (() => void) | undefined
        this.chain = new Promise<void>((resolve) => {
            release = resolve
        })

        await previous

        try {
            return await fn()
        } finally {
            release!()
        }
    }
}

class Lockfile {
    private readonly lockPath: string
    private readonly timeoutMs: number
    private readonly retryDelayMs: number

    public constructor(targetFilePath: string, timeoutMs: number, retryDelayMs: number) {
        this.lockPath = `${targetFilePath}.lock`
        this.timeoutMs = timeoutMs
        this.retryDelayMs = retryDelayMs
    }

    public async acquire(): Promise<() => Promise<void>> {
        const startedAt = Date.now()

        while (true) {
            const acquired = await this.tryCreate()

            if (acquired) {
                return async () => {
                    await this.safeUnlink(this.lockPath)
                }
            }

            const elapsed = Date.now() - startedAt

            if (elapsed >= this.timeoutMs) {
                throw new Error(`MutexFileStore lock timeout after ${elapsed}ms (lock: ${this.lockPath})`)
            }

            await this.sleep(this.retryDelayMs)
        }
    }

    private async tryCreate(): Promise<boolean> {
        try {
            const handle = await fs.open(this.lockPath, 'wx')

            try {
                await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, { encoding: 'utf8' })
                await handle.sync()
            } finally {
                await handle.close()
            }

            return true
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code

            if (code === 'EEXIST') return false

            throw err
        }
    }

    private async safeUnlink(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath)
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code

            if (code === 'ENOENT') return

            throw err
        }
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms))
    }
}

export abstract class MutexFileStore<T, TFileContent extends StoreFileContent> {
    protected readonly filePath: string
    protected readonly dirPath: string
    protected readonly initialValue: () => T
    protected readonly mutex: AsyncMutex
    protected readonly lockfile: Lockfile
    protected readonly onCorrupt?: (args: CorruptStoreArgs<TFileContent>) => void

    public constructor(options: MutexFileStoreOptions<T, TFileContent>) {
        this.filePath = options.filePath
        this.dirPath = path.dirname(options.filePath)
        this.initialValue = options.initialValue
        this.mutex = new AsyncMutex()

        const lockTimeoutMs = options.lockTimeoutMs ?? 5_000
        const lockRetryDelayMs = options.lockRetryDelayMs ?? 25

        this.lockfile = new Lockfile(this.filePath, lockTimeoutMs, lockRetryDelayMs)
        this.onCorrupt = options.onCorrupt
    }

    public async read(): Promise<T> {
        await this.ensureDirectory()

        const raw = await this.readFileOrNull(this.filePath)

        if (raw === null) {
            const initial = this.initialValue()

            await this.atomicWrite(initial)

            return initial
        }

        const parsed = this.deserialize(raw)

        if (parsed === null) {
            const backupPath = this.createCorruptBackupPath()

            await this.writeRawFile(backupPath, raw)
            this.onCorrupt?.({ filePath: this.filePath, raw, backupPath })

            const initial = this.initialValue()

            await this.atomicWrite(initial)

            return initial
        }

        return parsed
    }

    public async update(update: (current: T) => T | Promise<T>): Promise<T> {
        return await this.withStoreLock(async () => {
            const current = await this.read()
            const next = await update(current)

            await this.atomicWrite(next)

            return next
        })
    }

    protected async withStoreLock<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
        return await this.mutex.runExclusive(async () => {
            await this.ensureDirectory()

            const release = await this.lockfile.acquire()

            try {
                return await operation()
            } finally {
                await release()
            }
        })
    }

    protected async atomicWrite(value: T): Promise<void> {
        const fileContent = this.serialize(value)
        const tmpPath = path.join(this.dirPath, this.createTempFileName())

        const handle = await fs.open(tmpPath, 'w')

        try {
            await this.writeRawToHandle(handle, fileContent)
            await handle.sync()
        } finally {
            await handle.close()
        }

        await fs.rename(tmpPath, this.filePath)
    }

    protected async ensureDirectory(): Promise<void> {
        await fs.mkdir(this.dirPath, { recursive: true })
    }

    protected async readFileOrNull(filePath: string): Promise<TFileContent | null> {
        try {
            return await this.readExistingFile(filePath)
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code

            if (code === 'ENOENT') return null

            throw err
        }
    }

    protected async writeRawFile(filePath: string, fileContent: TFileContent): Promise<void> {
        if (typeof fileContent === 'string') {
            await fs.writeFile(filePath, fileContent, { encoding: 'utf8' })
            return
        }

        await fs.writeFile(filePath, fileContent)
    }

    protected async writeRawToHandle(handle: FileHandle, fileContent: TFileContent): Promise<void> {
        if (typeof fileContent === 'string') {
            await handle.writeFile(fileContent, { encoding: 'utf8' })
            return
        }

        await handle.writeFile(fileContent)
    }

    protected createTempFileName(): string {
        return `.tmp.${Date.now()}.${crypto.randomBytes(6).toString('hex')}${this.getTempFileExtension()}`
    }

    protected createCorruptBackupPath(): string {
        return `${this.filePath}.corrupt.${Date.now()}.bak`
    }

    protected getTempFileExtension(): string {
        return ''
    }

    protected abstract serialize(value: T): TFileContent

    protected abstract deserialize(raw: TFileContent): T | null

    protected abstract readExistingFile(filePath: string): Promise<TFileContent>
}

type MutexJsonStoreOptions<T> = MutexFileStoreOptions<T, string> & {
    jsonIndent?: number
}

export class MutexJsonStore<T> extends MutexFileStore<T, string> {
    private readonly jsonIndent: number

    public constructor(options: MutexJsonStoreOptions<T>) {
        super(options)

        this.jsonIndent = options.jsonIndent ?? 2
    }

    protected serialize(value: T): string {
        return `${JSON.stringify(value, null, this.jsonIndent)}\n`
    }

    protected deserialize(raw: string): T | null {
        try {
            return JSON.parse(raw) as T
        } catch {
            return null
        }
    }

    protected async readExistingFile(filePath: string): Promise<string> {
        return await fs.readFile(filePath, { encoding: 'utf8' })
    }

    protected getTempFileExtension(): string {
        return '.json'
    }
}