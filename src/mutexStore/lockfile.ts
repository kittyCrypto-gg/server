import { promises as fs } from 'fs'
import type { Stats } from 'fs'
import * as crypto from 'crypto'
import { hostname, uptime } from 'os'

type NodeErrorWithCode = Error & { code?: string }

type OwnedLockMetadata = {
    version: 1
    pid: number
    host: string
    bootId: string | null
    processStart: string | null
    createdAt: number
    token: string
}

type ExistingLock = {
    metadata: OwnedLockMetadata | null
    legacyPid: number | null
    legacyCreatedAt: number | null
    raw: string
    stat: Stats
}

const processStartIdentity = async (pid: number): Promise<string | null> => {
    try {
        const raw = await fs.readFile(`/proc/${pid}/stat`, { encoding: 'utf8' })
        const close = raw.lastIndexOf(')')
        if (close < 0) return null
        const fields = raw.slice(close + 1).trim().split(/\s+/u)
        const start = fields[19]
        return start === undefined || start.length === 0 ? null : start
    } catch (err: unknown) {
        const code = (err as NodeErrorWithCode).code
        if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') return null
        throw err
    }
}

const linuxBootId = async (): Promise<string | null> => {
    try {
        const value = (await fs.readFile('/proc/sys/kernel/random/boot_id', { encoding: 'utf8' })).trim()
        return value.length === 0 ? null : value
    } catch (err: unknown) {
        const code = (err as NodeErrorWithCode).code
        if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') return null
        throw err
    }
}

const processIsAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0)
        return true
    } catch (err: unknown) {
        const code = (err as NodeErrorWithCode).code
        if (code === 'ESRCH') return false
        if (code === 'EPERM') return true
        return true
    }
}

const ownedMetadata = (value: unknown): OwnedLockMetadata | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (record['version'] !== 1) return null
    if (!Number.isSafeInteger(record['pid']) || (record['pid'] as number) <= 0) return null
    if (typeof record['host'] !== 'string' || record['host'].length === 0) return null
    if (record['bootId'] !== null && typeof record['bootId'] !== 'string') return null
    if (record['processStart'] !== null && typeof record['processStart'] !== 'string') return null
    if (typeof record['createdAt'] !== 'number' || !Number.isFinite(record['createdAt']) || record['createdAt'] <= 0) return null
    if (typeof record['token'] !== 'string' || record['token'].length === 0) return null
    return {
        version: 1,
        pid: record['pid'] as number,
        host: record['host'],
        bootId: record['bootId'] as string | null,
        processStart: record['processStart'] as string | null,
        createdAt: record['createdAt'],
        token: record['token'],
    }
}

export class Lockfile {
    private readonly lockPath: string
    private readonly reapPath: string
    private readonly timeoutMs: number
    private readonly retryDelayMs: number
    private readonly host = hostname()
    private readonly bootStartedAt = Date.now() - uptime() * 1000
    private readonly bootId = linuxBootId()
    private readonly ownProcessStart = processStartIdentity(process.pid)

    public constructor(
        targetFilePath: string,
        timeoutMs: number,
        retryDelayMs: number,
        private readonly fileMode: number,
    ) {
        this.lockPath = `${targetFilePath}.lock`
        this.reapPath = `${this.lockPath}.reap`
        this.timeoutMs = timeoutMs
        this.retryDelayMs = retryDelayMs
    }

    public async acquire(): Promise<() => Promise<void>> {
        const startedAt = Date.now()

        while (true) {
            const acquired = await this.tryCreate()

            if (acquired !== null) {
                return async () => {
                    await this.release(acquired)
                }
            }

            await this.tryReapStaleLock()

            const elapsed = Date.now() - startedAt

            if (elapsed >= this.timeoutMs) {
                throw new Error(`MutexFileStore lock timeout after ${elapsed}ms (lock: ${this.lockPath})`)
            }

            await this.sleep(this.retryDelayMs)
        }
    }

    private async tryCreate(): Promise<OwnedLockMetadata | null> {
        if (await this.exists(this.reapPath)) {
            await this.finishExistingReap()
            return null
        }

        const metadata: OwnedLockMetadata = {
            version: 1,
            pid: process.pid,
            host: this.host,
            bootId: await this.bootId,
            processStart: await this.ownProcessStart,
            createdAt: Date.now(),
            token: crypto.randomUUID(),
        }
        const candidate = `${this.lockPath}.candidate.${process.pid}.${metadata.token}`

        await fs.writeFile(candidate, `${JSON.stringify(metadata)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: this.fileMode,
        })
        await fs.chmod(candidate, this.fileMode)
        try {
            try {
                // Publish only a fully-written owner record. A hard link is atomic:
                // the canonical lock path never exists as an empty or half-written
                // file, even if the process dies while acquiring it.
                await fs.link(candidate, this.lockPath)
                return metadata
            } catch (err: unknown) {
                const code = (err as NodeErrorWithCode).code
                if (code === 'EEXIST') return null
                throw err
            }
        } finally {
            await this.safeUnlink(candidate)
        }
    }

    private async tryReapStaleLock(): Promise<void> {
        const existing = await this.readExisting(this.lockPath)
        if (existing === null || !(await this.isStale(existing))) return

        try {
            // The reap marker is a hard link to the exact lock inode being judged
            // stale. It doubles as cross-process coordination: updated contenders
            // never publish a new lock while this marker exists.
            await fs.link(this.lockPath, this.reapPath)
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code
            if (code === 'ENOENT') return
            if (code === 'EEXIST') {
                await this.finishExistingReap()
                return
            }
            throw err
        }

        await this.finishExistingReap()
    }

    private async finishExistingReap(): Promise<void> {
        const marker = await this.readExisting(this.reapPath)
        if (marker === null) return
        if (!(await this.isStale(marker))) return

        const target = await this.readExisting(this.lockPath)
        if (target !== null && this.sameLock(marker, target)) {
            await this.safeUnlink(this.lockPath)
        }
        await this.safeUnlink(this.reapPath)
    }

    private sameLock(a: ExistingLock, b: ExistingLock): boolean {
        if (a.stat.dev !== b.stat.dev || a.stat.ino !== b.stat.ino) return false
        const aToken = a.metadata?.token
        const bToken = b.metadata?.token
        if (aToken !== undefined || bToken !== undefined) return aToken !== undefined && aToken === bToken
        return a.raw === b.raw
    }

    private async isStale(lock: ExistingLock): Promise<boolean> {
        const metadata = lock.metadata
        if (metadata !== null && metadata.host !== this.host) return false
        const bootId = metadata !== null ? await this.bootId : null
        if (metadata !== null && metadata.bootId !== null && bootId !== null && metadata.bootId !== bootId) return true
        if (metadata !== null && !processIsAlive(metadata.pid)) return true
        const currentStart = metadata?.processStart !== null && metadata !== null
            ? await processStartIdentity(metadata.pid)
            : null
        if (metadata !== null && metadata.processStart !== null
            && currentStart !== null && currentStart !== metadata.processStart) return true
        if (metadata !== null) return false

        // Compatibility with locks written by the previous implementation
        // ("pid\nISO-date\n") and with its crash-window empty files. A legacy
        // lock from before this boot is unambiguously stale. Within the current
        // boot we reclaim it only when its recorded PID is demonstrably dead.
        const beforeCurrentBoot = lock.stat.mtimeMs < this.bootStartedAt - 1000
            || (lock.legacyCreatedAt !== null && lock.legacyCreatedAt < this.bootStartedAt - 1000)
        if (beforeCurrentBoot) return true
        if (lock.legacyPid !== null && !processIsAlive(lock.legacyPid)) return true
        return false
    }

    private async readExisting(filePath: string): Promise<ExistingLock | null> {
        try {
            const [raw, stat] = await Promise.all([
                fs.readFile(filePath, { encoding: 'utf8' }),
                fs.stat(filePath),
            ])
            await fs.chmod(filePath, this.fileMode)
            let metadata: OwnedLockMetadata | null = null
            try {
                metadata = ownedMetadata(JSON.parse(raw))
            } catch {
                metadata = null
            }
            const lines = raw.split(/\r?\n/u)
            const legacyPidRaw = Number(lines[0])
            const legacyCreatedRaw = Date.parse(lines[1] ?? '')
            return {
                metadata,
                legacyPid: Number.isSafeInteger(legacyPidRaw) && legacyPidRaw > 0 ? legacyPidRaw : null,
                legacyCreatedAt: Number.isFinite(legacyCreatedRaw) ? legacyCreatedRaw : null,
                raw,
                stat,
            }
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code
            if (code === 'ENOENT') return null
            throw err
        }
    }

    private async release(owner: OwnedLockMetadata): Promise<void> {
        const current = await this.readExisting(this.lockPath)
        if (current?.metadata?.token !== owner.token) return
        await this.safeUnlink(this.lockPath)
    }

    private async exists(filePath: string): Promise<boolean> {
        try {
            await fs.stat(filePath)
            return true
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code
            if (code === 'ENOENT') return false
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
