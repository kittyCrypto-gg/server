import type { OwnedLockMetadata } from "./types"

export const ownedMetadata = (value: unknown): OwnedLockMetadata | null => {
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

