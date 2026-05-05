import * as path from "path"
import * as visits from "./visits"

export type ExtVisitsStoreOptions = visits.VisitsStoreOptions & {
    rootDirPath?: string
    siteFileName?: string
}

type ResolvedExtVisitsStoreOptions = {
    rootDirPath: string
    siteFileName: string
    fallbackFilePath: string
}

export class ExtVisitsStore extends visits.VisitsStore {
    protected readonly rootDirPath: string
    protected readonly siteFileName: string
    protected readonly siteStores: Map<string, visits.VisitsStore>

    public constructor(options: ExtVisitsStoreOptions = {}) {
        const resolvedOptions = ExtVisitsStore.resolveOptions(options)

        super({
            ...options,
            filePath: resolvedOptions.fallbackFilePath
        })

        this.rootDirPath = resolvedOptions.rootDirPath
        this.siteFileName = resolvedOptions.siteFileName
        this.siteStores = new Map<string, visits.VisitsStore>()
    }

    public async getStats(): Promise<visits.VisitsStats>
    public async getStats(origin: string): Promise<visits.VisitsStats>
    public async getStats(origin?: string): Promise<visits.VisitsStats> {
        if (typeof origin !== "string") {
            return await super.getStats()
        }

        return await this.getOriginStore(origin).getStats()
    }

    public async getPageStats(page: string): Promise<visits.PageVisitsStats>
    public async getPageStats(origin: string, page: string): Promise<visits.PageVisitsStats>
    public async getPageStats(first: string, second?: string): Promise<visits.PageVisitsStats> {
        if (typeof second !== "string") {
            return await super.getPageStats(first)
        }

        return await this.getOriginStore(first).getPageStats(second)
    }

    public async logVisit(ip: string, page: string, at?: Date): Promise<visits.VisitsLogResult>
    public async logVisit(origin: string, ip: string, page: string, at?: Date): Promise<visits.VisitsLogResult>
    public async logVisit(
        first: string,
        second: string,
        third?: string | Date,
        fourth?: Date
    ): Promise<visits.VisitsLogResult> {
        if (typeof third !== "string") {
            return await super.logVisit(first, second, third)
        }

        return await this.getOriginStore(first).logVisit(second, third, fourth)
    }

    protected getOriginStore(origin: string): visits.VisitsStore {
        const siteKey = this.normaliseOrigin(origin)

        if (!siteKey) {
            throw new Error("ExtVisitsStore requires a valid HTTPS origin or hostname with a TLD")
        }

        const existingStore = this.siteStores.get(siteKey)

        if (existingStore) {
            return existingStore
        }

        const store = this.createOriginStore(siteKey)

        this.siteStores.set(siteKey, store)

        return store
    }

    protected createOriginStore(siteKey: string): visits.VisitsStore {
        return new visits.VisitsStore({
            filePath: this.resolveOriginFilePath(siteKey),
            maxTimestampsPerIp: this.maxTimestampsPerIp,
            lockTimeoutMs: this.lockTimeoutMs,
            lockRetryDelayMs: this.lockRetryDelayMs
        })
    }

    protected resolveOriginFilePath(siteKey: string): string {
        return path.join(this.rootDirPath, siteKey, this.siteFileName)
    }

    protected normaliseOrigin(origin: string): string {
        const trimmed = this.safeDecode(origin).trim()

        if (!trimmed) {
            return ""
        }

        const candidate = this.hasUrlScheme(trimmed)
            ? trimmed
            : `https://${trimmed}`

        try {
            const url = new URL(candidate)

            if (url.protocol !== "https:") {
                return ""
            }

            if (url.username || url.password) {
                return ""
            }

            if (url.pathname !== "/" || url.search || url.hash) {
                return ""
            }

            if (!this.isValidExternalHostname(url.hostname)) {
                return ""
            }

            return this.createSiteKey(url.hostname, url.port)
        } catch {
            return ""
        }
    }

    protected isValidExternalHostname(hostname: string): boolean {
        const normalisedHostname = hostname
            .trim()
            .toLowerCase()
            .replace(/\.$/, "")

        if (!normalisedHostname) {
            return false
        }

        if (!normalisedHostname.includes(".")) {
            return false
        }

        const labels = normalisedHostname.split(".")

        if (labels.some((label) => !label)) {
            return false
        }

        return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    }

    protected createSiteKey(hostname: string, port: string): string {
        const hostKey = hostname
            .toLowerCase()
            .replace(/\.$/, "")
            .replace(/^www\./, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .replace(/-+/g, "-")

        if (!hostKey) {
            return ""
        }

        return port ? `${hostKey}-${port}` : hostKey
    }

    protected safeDecode(value: string): string {
        try {
            return decodeURIComponent(value)
        } catch {
            return value
        }
    }

    protected hasUrlScheme(value: string): boolean {
        return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    }

    protected static resolveOptions(options: ExtVisitsStoreOptions): ResolvedExtVisitsStoreOptions {
        const rootDirPath = ExtVisitsStore.resolveRootDirPath(options)
        const siteFileName = options.siteFileName ?? "visits.pb"
        const fallbackFilePath = options.filePath ?? path.join(rootDirPath, siteFileName)

        return {
            rootDirPath,
            siteFileName,
            fallbackFilePath
        }
    }

    protected static resolveRootDirPath(options: ExtVisitsStoreOptions): string {
        if (options.rootDirPath) {
            return path.resolve(options.rootDirPath)
        }

        if (options.filePath) {
            return path.dirname(path.resolve(options.filePath))
        }

        return path.resolve(process.cwd(), "data", "visits")
    }
}