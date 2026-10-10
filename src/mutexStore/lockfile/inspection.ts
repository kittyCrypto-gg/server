import { promises as fs } from "fs"
import type { NodeErrorWithCode, ExistingLock } from "./types"
import { ownedMetadata } from "./metadata"
import { processStartIdentity, processIsAlive } from "./processIdentity"

export type StalenessContext = {
    host: string
    bootId: Promise<string | null>
    bootStartedAt: number
}

export function sameLock(a: ExistingLock, b: ExistingLock): boolean {
    if (a.stat.dev !== b.stat.dev || a.stat.ino !== b.stat.ino) return false
    const aToken = a.metadata?.token
    const bToken = b.metadata?.token
    if (aToken !== undefined || bToken !== undefined) return aToken !== undefined && aToken === bToken
    return a.raw === b.raw
}


export async function isStaleLock(ctx: StalenessContext, lock: ExistingLock): Promise<boolean> {
    const metadata = lock.metadata
    if (metadata !== null && metadata.host !== ctx.host) return false
    const bootId = metadata !== null ? await ctx.bootId : null
    if (metadata !== null && metadata.bootId !== null && bootId !== null && metadata.bootId !== bootId) return true
    if (metadata !== null && !processIsAlive(metadata.pid)) return true
    const currentStart = metadata !== null && metadata.processStart !== null
        ? await processStartIdentity(metadata.pid)
        : null
    if (metadata !== null && metadata.processStart !== null
        && currentStart !== null && currentStart !== metadata.processStart) return true
    if (metadata !== null) return false

    // Compatibility with locks written by the previous implementation
    // ("pid\nISO-date\n") and with its crash-window empty files. A legacy
    // lock from before this boot is unambiguously stale. Within the current
    // boot we reclaim it only when its recorded PID is demonstrably dead.
    const beforeCurrentBoot = lock.stat.mtimeMs < ctx.bootStartedAt - 1000
        || (lock.legacyCreatedAt !== null && lock.legacyCreatedAt < ctx.bootStartedAt - 1000)
    if (beforeCurrentBoot) return true
    if (lock.legacyPid !== null && !processIsAlive(lock.legacyPid)) return true
    return false
}


export async function readExistingLock(filePath: string, fileMode: number): Promise<ExistingLock | null> {
    try {
        const [raw, stat] = await Promise.all([
            fs.readFile(filePath, { encoding: 'utf8' }),
            fs.stat(filePath),
        ])
        await fs.chmod(filePath, fileMode)
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

