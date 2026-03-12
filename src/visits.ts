import { MutexJsonStore } from "./mutexJsonStore"
import * as path from "path"

type IsoTimestamp = string

type VisitEntry = {
    count: number
    timestamps: IsoTimestamp[]
}

type VisitBucket = {
    visits: number
    ips: Record<string, VisitEntry>
}

type VisitsModel = VisitBucket & {
    pages: Record<string, VisitBucket>
    updatedAt: IsoTimestamp
}

export type VisitsStats = {
    visits: number
    uniqueVisitors: number
    updatedAt: IsoTimestamp
}

export type PageVisitsStats = VisitsStats & {
    page: string
}

export type PageVisitsLogResult = PageVisitsStats & {
    ipVisitCount: number
    lastVisitAt: IsoTimestamp
}

export type VisitsLogResult = VisitsStats & {
    ip: string
    ipVisitCount: number
    lastVisitAt: IsoTimestamp
    page?: PageVisitsLogResult
}

type VisitsStoreOptions = {
    filePath?: string
    maxTimestampsPerIp?: number
    lockTimeoutMs?: number
    lockRetryDelayMs?: number
}

export class VisitsStore {
    private readonly maxTimestampsPerIp: number
    private readonly store: MutexJsonStore<VisitsModel>

    public constructor(options: VisitsStoreOptions = {}) {
        const filePath = options.filePath ?? path.resolve(process.cwd(), "data", "visits.json")
        this.maxTimestampsPerIp = options.maxTimestampsPerIp ?? 50

        this.store = new MutexJsonStore<VisitsModel>({
            filePath,
            lockTimeoutMs: options.lockTimeoutMs,
            lockRetryDelayMs: options.lockRetryDelayMs,
            initialValue: () => ({
                visits: 0,
                ips: {},
                pages: {},
                updatedAt: new Date().toISOString()
            })
        })
    }

    public async getStats(): Promise<VisitsStats> {
        const model = this.withPages(await this.store.read())
        return this.toStats(model)
    }

    public async getPageStats(page: string): Promise<PageVisitsStats> {
        const normalisedPage = this.normalisePage(page)

        if (!normalisedPage) {
            throw new Error("VisitsStore.getPageStats requires a non-empty page string")
        }

        const model = this.withPages(await this.store.read())
        const pageBucket = model.pages[normalisedPage] ?? this.createEmptyBucket()

        return {
            page: normalisedPage,
            visits: pageBucket.visits,
            uniqueVisitors: Object.keys(pageBucket.ips).length,
            updatedAt: model.updatedAt
        }
    }

    public async logVisit(ip: string, at?: Date): Promise<VisitsLogResult>
    public async logVisit(ip: string, page: string, at?: Date): Promise<VisitsLogResult>
    public async logVisit(ip: string, pageOrAt?: string | Date, at: Date = new Date()): Promise<VisitsLogResult> {
        const normalisedIp = this.normaliseIp(ip)

        if (!normalisedIp) {
            throw new Error("VisitsStore.logVisit requires a non-empty ip string")
        }

        const page = typeof pageOrAt === "string"
            ? this.normalisePage(pageOrAt)
            : ""

        if (typeof pageOrAt === "string" && !page) {
            throw new Error("VisitsStore.logVisit requires a non-empty page string")
        }

        const visitDate = pageOrAt instanceof Date ? pageOrAt : at
        const timestamp = visitDate.toISOString()

        const next = await this.store.update((current) =>
            this.applyVisit(this.withPages(current), normalisedIp, timestamp, page || undefined)
        )

        const entry = next.ips[normalisedIp]

        const result: VisitsLogResult = {
            ...this.toStats(next),
            ip: normalisedIp,
            ipVisitCount: entry.count,
            lastVisitAt: entry.timestamps[entry.timestamps.length - 1] ?? timestamp
        }

        if (!page) {
            return result
        }

        const pageBucket = next.pages[page]
        const pageEntry = pageBucket.ips[normalisedIp]

        return {
            ...result,
            page: {
                page,
                visits: pageBucket.visits,
                uniqueVisitors: Object.keys(pageBucket.ips).length,
                updatedAt: next.updatedAt,
                ipVisitCount: pageEntry.count,
                lastVisitAt: pageEntry.timestamps[pageEntry.timestamps.length - 1] ?? timestamp
            }
        }
    }

    private toStats(model: VisitsModel): VisitsStats {
        return {
            visits: model.visits,
            uniqueVisitors: Object.keys(model.ips).length,
            updatedAt: model.updatedAt
        }
    }

    private applyVisit(
        model: VisitsModel,
        ip: string,
        timestamp: IsoTimestamp,
        page?: string
    ): VisitsModel {
        const nextOverall = this.applyVisitToBucket(model, ip, timestamp)

        if (!page) {
            return {
                ...nextOverall,
                pages: model.pages,
                updatedAt: timestamp
            }
        }

        const currentPage = model.pages[page] ?? this.createEmptyBucket()
        const nextPage = this.applyVisitToBucket(currentPage, ip, timestamp)

        return {
            ...nextOverall,
            pages: {
                ...model.pages,
                [page]: nextPage
            },
            updatedAt: timestamp
        }
    }

    private applyVisitToBucket(
        bucket: VisitBucket,
        ip: string,
        timestamp: IsoTimestamp
    ): VisitBucket {
        const existing = bucket.ips[ip]

        const nextEntry: VisitEntry = existing
            ? {
                count: existing.count + 1,
                timestamps: this.appendCapped(existing.timestamps, timestamp, this.maxTimestampsPerIp)
            }
            : {
                count: 1,
                timestamps: [timestamp]
            }

        return {
            visits: bucket.visits + 1,
            ips: {
                ...bucket.ips,
                [ip]: nextEntry
            }
        }
    }

    private createEmptyBucket(): VisitBucket {
        return {
            visits: 0,
            ips: {}
        }
    }

    private withPages(model: VisitsModel): VisitsModel {
        return {
            ...model,
            pages: this.isRecord(model.pages) ? model.pages as Record<string, VisitBucket> : {}
        }
    }

    private appendCapped(list: string[], value: string, max: number): string[] {
        const next = [...list, value]
        const overflow = next.length - max

        if (overflow <= 0) {
            return next
        }

        return next.slice(overflow)
    }

    private normaliseIp(ip: string): string {
        const trimmed = ip.trim()

        if (trimmed.startsWith("::ffff:")) {
            return trimmed.slice("::ffff:".length)
        }

        return trimmed
    }

    private normalisePage(page: string): string {
        const trimmed = page.trim()

        if (!trimmed) {
            return ""
        }

        const candidate = trimmed.startsWith("http://") || trimmed.startsWith("https://")
            ? trimmed
            : `https://placeholder${trimmed.startsWith("/") ? "" : "/"}${trimmed}`

        try {
            const url = new URL(candidate)
            const pathname = url.pathname.replace(/\/+$/, "") || "/"
            const normalisedPathname = pathname === "/index.html" ? "/" : pathname

            return `${normalisedPathname}${url.search}`
        } catch {
            return ""
        }
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value)
    }
}