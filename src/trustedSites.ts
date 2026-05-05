import * as store from "./trustedSitesStore"

type Uts = number

type FetchLike = (
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

type MemKeyFile = {
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

export class TrSites {
    private readonly store: store.TrSitesStore
    private readonly fetchFn: FetchLike
    private readonly srvBaseUrl?: string
    private readonly maxKeyFileBytes: number
    private readonly fetchTimeoutMs: number
    private readonly keyFiles: Map<string, MemKeyFile>

    public constructor(opts: TrSitesLogicOpts = {}) {
        this.store = opts.store ?? new store.TrSitesStore(opts)
        this.fetchFn = opts.fetchFn ?? this.defaultFetch
        this.srvBaseUrl = opts.srvBaseUrl?.trim() || undefined
        this.maxKeyFileBytes = opts.maxKeyFileBytes ?? 4_096
        this.fetchTimeoutMs = opts.fetchTimeoutMs ?? 8_000
        this.keyFiles = new Map<string, MemKeyFile>()
    }

    public async reg(args: RegSiteArgs): Promise<RegSiteRes> {
        const origin = this.siteToOrig(args.site)
        const siteKey = this.mkSiteKey(origin)
        const srvBaseUrl = args.srvBaseUrl?.trim() || this.srvBaseUrl

        if (!srvBaseUrl) {
            throw new Error("Server base URL is required to build the key-file download URL.")
        }

        const chal = await this.store.mkChal({
            origin,
            requesterKey: args.requesterKey,
            now: args.now
        })

        const keyFile: KeyFileRes = {
            fileName: "kittycrow.key",
            contentType: "application/json; charset=utf-8",
            body: chal.keyFileText,
            keyFileSha256: chal.keyFileSha256
        }

        this.keyFiles.set(origin, {
            origin,
            body: chal.keyFileText,
            keyFileSha256: chal.keyFileSha256,
            expiresAt: chal.expiresAt
        })

        this.pruneKeyFiles(args.now ?? Date.now())

        return {
            ...chal,
            siteKey,
            keyFileName: keyFile.fileName,
            keyFileDownloadUrl: this.mkDlUrl({
                srvBaseUrl,
                origin
            }),
            keyFile
        }
    }

    public key(args: KeyFileArgs): KeyFileRes {
        const origin = this.siteToOrig(args.site)
        const now = args.now ?? Date.now()

        this.pruneKeyFiles(now)

        const keyFile = this.keyFiles.get(origin)

        if (!keyFile || keyFile.expiresAt <= now) {
            throw new Error("Verification key file was not found or has expired. Register the site again.")
        }

        return {
            fileName: "kittycrow.key",
            contentType: "application/json; charset=utf-8",
            body: keyFile.body,
            keyFileSha256: keyFile.keyFileSha256
        }
    }

    public async chk(args: ChkSiteArgs): Promise<ChkSiteRes> {
        const origin = this.siteToOrig(args.site)
        const verificationUrl = this.store.mkVrfUrl(origin)
        const keyFileText = await this.fetchKeyFile(verificationUrl)
        const fetchedKeyFileSha256 = this.store.hashKeyFile(keyFileText)

        const result = await this.store.vrfChal({
            origin,
            keyFileText,
            requesterKey: args.requesterKey,
            now: args.now
        })

        if (result.verified) {
            this.keyFiles.delete(origin)
        }

        return {
            ...result,
            verificationUrl,
            fetchedKeyFileSha256
        }
    }

    public async isTrst(origin: string): Promise<boolean> {
        return await this.store.isTrst(origin)
    }

    public normOrig(origin: string): string {
        return this.store.normOrig(origin)
    }

    public mkSiteKey(origin: string): string {
        const normalisedOrigin = this.store.normOrig(origin)
        const url = new URL(normalisedOrigin)

        const hostKey = url.hostname
            .toLowerCase()
            .replace(/\.$/, "")
            .replace(/^www\./, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .replace(/-+/g, "-")

        if (!hostKey) {
            throw new Error("Site origin could not be converted into a site key.")
        }

        return url.port ? `${hostKey}-${url.port}` : hostKey
    }

    public readSiteParam(site: unknown): string {
        if (typeof site !== "string" || !site.trim()) {
            throw new Error("Route requires a site parameter.")
        }

        return site
    }

    public siteToOrig(site: string): string {
        const decoded = this.safeDecode(site).trim()

        if (!decoded) {
            throw new Error("Site parameter is required.")
        }

        if (this.hasScheme(decoded)) {
            return this.store.normOrig(decoded)
        }

        return this.store.normOrig(`https://${decoded}`)
    }

    private safeDecode(value: string): string {
        try {
            return decodeURIComponent(value)
        } catch {
            return value
        }
    }

    private hasScheme(value: string): boolean {
        return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    }

    private mkRouteSite(origin: string): string {
        const normalisedOrigin = this.store.normOrig(origin)
        const url = new URL(normalisedOrigin)

        return url.host.toLowerCase()
    }

    private mkDlUrl(args: {
        srvBaseUrl: string
        origin: string
    }): string {
        const routeSite = this.mkRouteSite(args.origin)
        const url = new URL(`/verify/${encodeURIComponent(routeSite)}/kittycrow.key`, args.srvBaseUrl)

        return url.toString()
    }

    private async fetchKeyFile(url: string): Promise<string> {
        const ctl = new AbortController()
        const timeout = setTimeout(() => ctl.abort(), this.fetchTimeoutMs)

        try {
            const res = await this.fetchFn(url, {
                signal: ctl.signal
            })

            if (!res.ok) {
                throw new Error(`Verification key file returned HTTP ${String(res.status)}.`)
            }

            this.assertKeyFileLen(res.headers.get("content-length"))

            const txt = await res.text()

            this.assertKeyFileTxtLen(txt)

            return txt
        } finally {
            clearTimeout(timeout)
        }
    }

    private assertKeyFileLen(contentLength: string | null): void {
        if (contentLength === null) {
            return
        }

        const size = Number(contentLength)

        if (!Number.isFinite(size) || size <= this.maxKeyFileBytes) {
            return
        }

        throw new Error("Verification key file is too large.")
    }

    private assertKeyFileTxtLen(txt: string): void {
        const size = Buffer.byteLength(txt, "utf8")

        if (size <= this.maxKeyFileBytes) {
            return
        }

        throw new Error("Verification key file is too large.")
    }

    private pruneKeyFiles(now: Uts): void {
        for (const [origin, keyFile] of this.keyFiles) {
            if (keyFile.expiresAt > now) {
                continue
            }

            this.keyFiles.delete(origin)
        }
    }

    private async defaultFetch(url: string, init?: { signal?: AbortSignal }): Promise<{
        ok: boolean
        status: number
        headers: {
            get: (name: string) => string | null
        }
        text: () => Promise<string>
    }> {
        if (typeof globalThis.fetch !== "function") {
            throw new Error("Fetch is not available. Provide fetchFn in TrSitesLogicOpts.")
        }

        return await globalThis.fetch(url, init)
    }
}