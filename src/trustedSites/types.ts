import * as store from '../trustedSitesStore'

export type Uts = number

export type FetchLike = (
    url: string,
    init?: {
        signal?: AbortSignal
    }
) => Promise<{
    ok: boolean
    status: number
    headers: {
        get: (name: string) => string | null
    }
    text: () => Promise<string>
}>

export type MemKeyFile = {
    origin: string
    body: string
    keyFileSha256: string
    expiresAt: Uts
}

export type TrSitesLogicOpts = store.TrSitesOpts & {
    store?: store.TrSitesStore
    fetchFn?: FetchLike
    srvBaseUrl?: string
    maxKeyFileBytes?: number
    fetchTimeoutMs?: number
}

export type RegSiteArgs = {
    site: string
    requesterKey?: string
    srvBaseUrl?: string
    now?: Uts
}

export type RegSiteRes = store.MkChalRes & {
    siteKey: string
    keyFileName: string
    keyFileDownloadUrl: string
    keyFile: KeyFileRes
}

export type KeyFileArgs = {
    site: string
    now?: Uts
}

export type KeyFileRes = {
    fileName: string
    contentType: string
    body: string
    keyFileSha256: string
}

export type ChkSiteArgs = {
    site: string
    requesterKey?: string
    now?: Uts
}

export type ChkSiteRes = store.VrfChalRes & {
    verificationUrl: string
    fetchedKeyFileSha256?: string
}

