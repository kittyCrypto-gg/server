import { MutexJsonStore } from "./mutexJsonStore"
import * as path from "path"

type UnixTimestampMs = number

type VisitEntry = {
    count: number
    timestamps: UnixTimestampMs[]
}

type VisitBucket = {
    visits: number
    ips: Record<string, VisitEntry>
}

type VisitsModel = {
    pages: Record<string, VisitBucket>
    updatedAt: UnixTimestampMs
}

type LegacyIsoTimestamp = string

type LegacyVisitEntry = {
    count: number
    timestamps: LegacyIsoTimestamp[]
}

type LegacyVisitBucket = {
    visits: number
    ips: Record<string, LegacyVisitEntry>
}

type LegacyVisitsModel = LegacyVisitBucket & {
    pages: Record<string, LegacyVisitBucket>
    updatedAt: LegacyIsoTimestamp | UnixTimestampMs
}

export type VisitsStats = {
    visits: number
    uniqueVisitors: number
    updatedAt: UnixTimestampMs
}

export type PageVisitsStats = VisitsStats & {
    page: string
}

export type PageVisitsLogResult = PageVisitsStats & {
    ipVisitCount: number
    lastVisitAt: UnixTimestampMs
}

export type VisitsLogResult = VisitsStats & {
    ip: string
    ipVisitCount: number
    lastVisitAt: UnixTimestampMs
    page: PageVisitsLogResult
}

type VisitsStoreOptions = {
    filePath?: string
    maxTimestampsPerIp?: number
    lockTimeoutMs?: number
    lockRetryDelayMs?: number
}

export class VisitsStore {
    private readonly maxTimestampsPerIp: number
    private readonly store: MutexJsonStore<VisitsModel | LegacyVisitsModel>

    public constructor(options: VisitsStoreOptions = {}) {
        const filePath = options.filePath ?? path.resolve(process.cwd(), "data", "visits.json")
        this.maxTimestampsPerIp = options.maxTimestampsPerIp ?? 50

        this.store = new MutexJsonStore<VisitsModel | LegacyVisitsModel>({
            filePath,
            lockTimeoutMs: options.lockTimeoutMs,
            lockRetryDelayMs: options.lockRetryDelayMs,
            initialValue: () => ({
                pages: {},
                updatedAt: Date.now()
            })
        })
    }

    public async getStats(): Promise<VisitsStats> {
        const model = this.normaliseModel(await this.store.read())
        return this.toStats(model)
    }

    public async getPageStats(page: string): Promise<PageVisitsStats> {
        const normalisedPage = this.normalisePage(page)

        if (!normalisedPage) {
            throw new Error("VisitsStore.getPageStats requires a non-empty page string")
        }

        const model = this.normaliseModel(await this.store.read())
        const pageBucket = model.pages[normalisedPage] ?? this.createEmptyBucket()

        return {
            page: normalisedPage,
            visits: pageBucket.visits,
            uniqueVisitors: Object.keys(pageBucket.ips).length,
            updatedAt: model.updatedAt
        }
    }

    public async logVisit(ip: string, page: string, at: Date = new Date()): Promise<VisitsLogResult> {
        const normalisedIp = this.normaliseIp(ip)
        const normalisedPage = this.normalisePage(page)

        if (!normalisedIp) {
            throw new Error("VisitsStore.logVisit requires a non-empty ip string")
        }

        if (!normalisedPage) {
            throw new Error("VisitsStore.logVisit requires a non-empty page string")
        }

        const timestamp = at.getTime()

        const next = this.normaliseModel(
            await this.store.update((current) =>
                this.applyVisit(this.normaliseModel(current), normalisedIp, normalisedPage, timestamp)
            )
        )

        const pageBucket = next.pages[normalisedPage]
        const pageEntry = pageBucket.ips[normalisedIp]
        const overallStats = this.toStats(next)
        const overallIpVisitCount = this.getOverallIpVisitCount(next, normalisedIp)
        const overallLastVisitAt = this.getOverallLastVisitAt(next, normalisedIp) ?? timestamp

        return {
            ...overallStats,
            ip: normalisedIp,
            ipVisitCount: overallIpVisitCount,
            lastVisitAt: overallLastVisitAt,
            page: {
                page: normalisedPage,
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
            visits: this.getOverallVisits(model),
            uniqueVisitors: this.getOverallUniqueVisitors(model),
            updatedAt: model.updatedAt
        }
    }

    private applyVisit(
        model: VisitsModel,
        ip: string,
        page: string,
        timestamp: UnixTimestampMs
    ): VisitsModel {
        const currentPage = model.pages[page] ?? this.createEmptyBucket()
        const nextPage = this.applyVisitToBucket(currentPage, ip, timestamp)

        return {
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
        timestamp: UnixTimestampMs
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

    private normaliseModel(model: VisitsModel | LegacyVisitsModel): VisitsModel {
        const rawPages = this.readPages(model)
        const pages: Record<string, VisitBucket> = {}

        for (const [rawPage, rawBucket] of Object.entries(rawPages)) {
            const page = this.normalisePage(rawPage)

            if (!page) {
                continue
            }

            const bucket = this.normaliseBucket(rawBucket)

            if (!bucket.visits && !Object.keys(bucket.ips).length) {
                continue
            }

            pages[page] = bucket
        }

        return {
            pages,
            updatedAt: this.normaliseTimestamp((model as { updatedAt?: unknown }).updatedAt) ?? Date.now()
        }
    }

    private normaliseBucket(value: unknown): VisitBucket {
        if (!this.isRecord(value)) {
            return this.createEmptyBucket()
        }

        const rawIps = this.isRecord(value.ips) ? value.ips : {}
        const ips: Record<string, VisitEntry> = {}
        let visits = 0

        for (const [rawIp, rawEntry] of Object.entries(rawIps)) {
            const ip = this.normaliseIp(rawIp)

            if (!ip) {
                continue
            }

            const entry = this.normaliseEntry(rawEntry)

            if (!entry) {
                continue
            }

            ips[ip] = entry
            visits += entry.count
        }

        return {
            visits,
            ips
        }
    }

    private normaliseEntry(value: unknown): VisitEntry | undefined {
        if (!this.isRecord(value)) {
            return undefined
        }

        const rawTimestamps = Array.isArray(value.timestamps) ? value.timestamps : []
        const timestamps = rawTimestamps
            .map((item) => this.normaliseTimestamp(item))
            .filter((item): item is number => typeof item === "number")
            .sort((left, right) => left - right)
            .slice(-this.maxTimestampsPerIp)

        const rawCount = value.count
        const count = typeof rawCount === "number" && Number.isFinite(rawCount) && rawCount > 0
            ? Math.floor(rawCount)
            : timestamps.length

        if (!count) {
            return undefined
        }

        return {
            count,
            timestamps
        }
    }

    private getOverallVisits(model: VisitsModel): number {
        let visits = 0

        for (const bucket of Object.values(model.pages)) {
            visits += bucket.visits
        }

        return visits
    }

    private getOverallUniqueVisitors(model: VisitsModel): number {
        const uniqueIps = new Set<string>()

        for (const bucket of Object.values(model.pages)) {
            for (const ip of Object.keys(bucket.ips)) {
                uniqueIps.add(ip)
            }
        }

        return uniqueIps.size
    }

    private getOverallIpVisitCount(model: VisitsModel, ip: string): number {
        let count = 0

        for (const bucket of Object.values(model.pages)) {
            count += bucket.ips[ip]?.count ?? 0
        }

        return count
    }

    private getOverallLastVisitAt(model: VisitsModel, ip: string): UnixTimestampMs | undefined {
        let lastVisitAt: UnixTimestampMs | undefined

        for (const bucket of Object.values(model.pages)) {
            const entry = bucket.ips[ip]
            const candidate = entry?.timestamps[entry.timestamps.length - 1]

            if (typeof candidate !== "number") {
                continue
            }

            if (typeof lastVisitAt !== "number" || candidate > lastVisitAt) {
                lastVisitAt = candidate
            }
        }

        return lastVisitAt
    }

    private createEmptyBucket(): VisitBucket {
        return {
            visits: 0,
            ips: {}
        }
    }

    private readPages(model: VisitsModel | LegacyVisitsModel): Record<string, unknown> {
        const candidate = (model as { pages?: unknown }).pages
        return this.isRecord(candidate) ? candidate : {}
    }

    private appendCapped(list: number[], value: number, max: number): number[] {
        const next = [...list, value]
        const overflow = next.length - max

        if (overflow <= 0) {
            return next
        }

        return next.slice(overflow)
    }

    private normaliseTimestamp(value: unknown): UnixTimestampMs | undefined {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            return Math.floor(value)
        }

        if (typeof value !== "string") {
            return undefined
        }

        const parsed = Date.parse(value)

        if (!Number.isFinite(parsed)) {
            return undefined
        }

        return parsed
    }

    private normaliseIp(ip: string): string {
        const trimmed = ip.trim()

        if (!trimmed) {
            return ""
        }

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