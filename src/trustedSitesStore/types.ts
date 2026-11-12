export type Uts = number

export type TrSiteRec = {
    origin: string
    verifiedAt: Uts
    verificationPath: string
    lastChallengeAt: Uts
}

export type PendSiteChal = {
    origin: string
    challengeTokenHash: string
    keyFileSha256: string
    createdAt: Uts
    expiresAt: Uts
    verificationPath: string
    requesterKey: string
}

export type TrSitesState = {
    pendingChallenges: Record<string, PendSiteChal>
    trustedSites: Record<string, TrSiteRec>
    updatedAt: Uts
}

export type TrSitesOpts = {
    filePath?: string
    challengeTtlMs?: number
    verificationPath?: string
    allowHttp?: boolean
    lockTimeoutMs?: number
    lockRetryDelayMs?: number
}

export type MkChalArgs = {
    origin: string
    requesterKey?: string
    now?: Uts
}

export type MkChalRes = {
    origin: string
    challengeToken: string
    challengeTokenHash: string
    keyFileSha256: string
    keyFileText: string
    verificationPath: string
    verificationUrl: string
    expiresAt: Uts
}

export type VrfChalArgs = {
    origin: string
    keyFileText: string
    requesterKey?: string
    now?: Uts
}

export type VrfChalRes = {
    verified: boolean
    origin: string
    trustedSite?: TrSiteRec
    reason?: string
}

export type KeyFilePayload = {
    service: string
    origin: string
    challengeToken: string
}
