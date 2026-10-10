import { promises as fs } from 'fs'
import * as crypto from 'crypto'
import { hostname, uptime } from 'os'
import type { NodeErrorWithCode, OwnedLockMetadata, ExistingLock } from './lockfile/types'
import { processStartIdentity, linuxBootId } from './lockfile/processIdentity'
import { sameLock, isStaleLock, readExistingLock } from './lockfile/inspection'

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
        return sameLock(a, b)
    }

    private async isStale(lock: ExistingLock): Promise<boolean> {
        return await isStaleLock({
            host: this.host,
            bootId: this.bootId,
            bootStartedAt: this.bootStartedAt,
        }, lock)
    }

    private async readExisting(filePath: string): Promise<ExistingLock | null> {
        return await readExistingLock(filePath, this.fileMode)
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
