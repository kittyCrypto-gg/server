import { promises as fs } from 'fs'
import type { FileHandle } from 'fs/promises'
import * as crypto from 'crypto'
import * as path from 'path'
import { AsyncMutex } from './mutexStore/asyncMutex'
import { Lockfile } from './mutexStore/lockfile'

type NodeErrorWithCode = Error & { code?: string }

type StoreFileContent = string | Buffer

export type CorruptionPolicy = 'recover' | 'throw'

const DEFAULT_FILE_MODE = 0o600
const DEFAULT_DIR_MODE = 0o700

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
    fileMode?: number
    dirMode?: number
    corruptionPolicy?: CorruptionPolicy
    onCorrupt?: (args: CorruptStoreArgs<TFileContent>) => void
}

const permissionMode = (value: number | undefined, fallback: number, label: string): number => {
    const resolved = value ?? fallback
    if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > 0o777) {
        throw new Error(`${label} must be a Unix permission mode between 000 and 777`)
    }
    return resolved
}

export abstract class MutexFileStore<T, TFileContent extends StoreFileContent> {
    protected readonly filePath: string
    protected readonly dirPath: string
    protected readonly initialValue: () => T
    protected readonly mutex: AsyncMutex
    protected readonly lockfile: Lockfile
    protected readonly onCorrupt: ((args: CorruptStoreArgs<TFileContent>) => void) | undefined
    protected readonly fileMode: number
    protected readonly dirMode: number
    private readonly corruptionPolicy: CorruptionPolicy

    public constructor(options: MutexFileStoreOptions<T, TFileContent>) {
        this.filePath = options.filePath
        this.dirPath = path.dirname(options.filePath)
        this.initialValue = options.initialValue
        this.mutex = new AsyncMutex()
        this.fileMode = permissionMode(options.fileMode, DEFAULT_FILE_MODE, 'MutexFileStore fileMode')
        this.dirMode = permissionMode(options.dirMode, DEFAULT_DIR_MODE, 'MutexFileStore dirMode')
        this.corruptionPolicy = options.corruptionPolicy ?? 'recover'

        const lockTimeoutMs = options.lockTimeoutMs ?? 5_000
        const lockRetryDelayMs = options.lockRetryDelayMs ?? 25

        this.lockfile = new Lockfile(this.filePath, lockTimeoutMs, lockRetryDelayMs, this.fileMode)
        this.onCorrupt = options.onCorrupt
    }

    public async read(): Promise<T> {
        return await this.load(true)
    }

    public async update(update: (current: T) => T | Promise<T>): Promise<T> {
        return await this.withStoreLock(async () => {
            // A missing or recoverably corrupt store should feed the initial value
            // straight into the mutation. Writing that initial value first only to
            // overwrite it immediately doubles durable I/O on first mutation.
            const current = await this.load(false)
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

        const handle = await fs.open(tmpPath, 'w', this.fileMode)

        try {
            await handle.chmod(this.fileMode)
            await this.writeRawToHandle(handle, fileContent)
            // The data file remains synchronously flushed before atomic rename.
            await handle.sync()
        } finally {
            await handle.close()
        }

        await fs.rename(tmpPath, this.filePath)
        await fs.chmod(this.filePath, this.fileMode)
    }

    protected async ensureDirectory(): Promise<void> {
        await fs.mkdir(this.dirPath, { recursive: true, mode: this.dirMode })
        await fs.chmod(this.dirPath, this.dirMode)
    }

    protected async readFileOrNull(filePath: string): Promise<TFileContent | null> {
        try {
            const value = await this.readExistingFile(filePath)
            await fs.chmod(filePath, this.fileMode)
            return value
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code

            if (code === 'ENOENT') return null

            throw err
        }
    }

    protected async writeRawFile(filePath: string, fileContent: TFileContent): Promise<void> {
        if (typeof fileContent === 'string') {
            await fs.writeFile(filePath, fileContent, { encoding: 'utf8', mode: this.fileMode })
        } else {
            await fs.writeFile(filePath, fileContent, { mode: this.fileMode })
        }
        await fs.chmod(filePath, this.fileMode)
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

    private async load(persistInitial: boolean): Promise<T> {
        await this.ensureDirectory()

        const raw = await this.readFileOrNull(this.filePath)

        if (raw === null) {
            const initial = this.initialValue()

            if (persistInitial) await this.atomicWrite(initial)

            return initial
        }

        const parsed = this.deserialize(raw)

        if (parsed !== null) return parsed

        const backupPath = this.createCorruptBackupPath()

        await this.writeRawFile(backupPath, raw)
        this.onCorrupt?.({ filePath: this.filePath, raw, backupPath })
        if (this.corruptionPolicy === 'throw') {
            throw new Error(`MutexFileStore detected corrupt state at ${this.filePath}; backup written to ${backupPath}`)
        }

        const initial = this.initialValue()

        if (persistInitial) await this.atomicWrite(initial)

        return initial
    }
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

    protected override getTempFileExtension(): string {
        return '.json'
    }
}

