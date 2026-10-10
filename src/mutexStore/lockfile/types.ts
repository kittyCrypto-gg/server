import type { Stats } from "fs"

export type NodeErrorWithCode = Error & { code?: string }

export type OwnedLockMetadata = {
    version: 1
    pid: number
    host: string
    bootId: string | null
    processStart: string | null
    createdAt: number
    token: string
}

export type ExistingLock = {
    metadata: OwnedLockMetadata | null
    legacyPid: number | null
    legacyCreatedAt: number | null
    raw: string
    stat: Stats
}

