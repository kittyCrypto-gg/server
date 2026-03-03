import { promises as fs } from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

type NodeErrorWithCode = Error & { code?: string }

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
                throw new Error(`MutexJsonStore lock timeout after ${elapsed}ms (lock: ${this.lockPath})`)
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

type MutexJsonStoreOptions<T> = {
    filePath: string
    initialValue: () => T
    lockTimeoutMs?: number
    lockRetryDelayMs?: number
    jsonIndent?: number
    onCorrupt?: (args: { filePath: string; raw: string; backupPath: string }) => void
}

export class MutexJsonStore<T> {
    private readonly filePath: string
    private readonly dirPath: string
    private readonly initialValue: () => T
    private readonly mutex: AsyncMutex
    private readonly lockfile: Lockfile
    private readonly jsonIndent: number
    private readonly onCorrupt?: (args: { filePath: string; raw: string; backupPath: string }) => void

    public constructor(options: MutexJsonStoreOptions<T>) {
        this.filePath = options.filePath
        this.dirPath = path.dirname(options.filePath)
        this.initialValue = options.initialValue
        this.mutex = new AsyncMutex()

        const lockTimeoutMs = options.lockTimeoutMs ?? 5_000
        const lockRetryDelayMs = options.lockRetryDelayMs ?? 25
        this.lockfile = new Lockfile(this.filePath, lockTimeoutMs, lockRetryDelayMs)

        this.jsonIndent = options.jsonIndent ?? 2
        this.onCorrupt = options.onCorrupt
    }

    public async read(): Promise<T> {
        await fs.mkdir(this.dirPath, { recursive: true })

        const raw = await this.readFileOrNull(this.filePath)
        if (raw === null) {
            const initial = this.initialValue()
            await this.atomicWrite(initial)
            return initial
        }

        const parsed = this.safeParse(raw)
        if (parsed === null) {
            const backupPath = `${this.filePath}.corrupt.${Date.now()}.bak`
            await fs.writeFile(backupPath, raw, { encoding: 'utf8' })
            this.onCorrupt?.({ filePath: this.filePath, raw, backupPath })

            const initial = this.initialValue()
            await this.atomicWrite(initial)
            return initial
        }

        return parsed
    }

    public async update(update: (current: T) => T | Promise<T>): Promise<T> {
        return await this.mutex.runExclusive(async () => {
            await fs.mkdir(this.dirPath, { recursive: true })

            const release = await this.lockfile.acquire()
            try {
                const current = await this.read()
                const next = await update(current)
                await this.atomicWrite(next)
                return next
            } finally {
                await release()
            }
        })
    }

    private async atomicWrite(value: T): Promise<void> {
        const json = `${JSON.stringify(value, null, this.jsonIndent)}\n`
        const tmpName = `.tmp.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.json`
        const tmpPath = path.join(this.dirPath, tmpName)

        const handle = await fs.open(tmpPath, 'w')
        try {
            await handle.writeFile(json, { encoding: 'utf8' })
            await handle.sync()
        } finally {
            await handle.close()
        }

        await fs.rename(tmpPath, this.filePath)
    }

    private async readFileOrNull(filePath: string): Promise<string | null> {
        try {
            return await fs.readFile(filePath, { encoding: 'utf8' })
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code
            if (code === 'ENOENT') return null
            throw err
        }
    }

    private safeParse(raw: string): T | null {
        try {
            return JSON.parse(raw) as T
        } catch {
            return null
        }
    }
}