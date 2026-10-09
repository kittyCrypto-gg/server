import type { VisitsContext } from "./context"
import type { UnixTimestampMs, VisitEntry, VisitBucket, VisitsModel, LegacyIsoTimestamp, LegacyVisitEntry, LegacyVisitBucket, LegacyVisitsModel, VisitsModelInput, VisitsStats, PageVisitsStats, PageVisitsLogResult, VisitsLogResult, VisitsStoreOptions, VisitsStorePaths, VisitsBackingStore } from "./types"

export function normaliseModel(ctx: VisitsContext, model: VisitsModelInput): VisitsModel {
        const rawPages = ctx.readPages(model)
        const pages: Record<string, VisitBucket> = {}

        for (const [rawPage, rawBucket] of Object.entries(rawPages)) {
            const page = ctx.normalisePage(rawPage)

            if (!page) {
                continue
            }

            const bucket = ctx.normaliseBucket(rawBucket)

            if (!bucket.visits && !Object.keys(bucket.ips).length) {
                continue
            }

            pages[page] = bucket
        }

        return {
            pages,
            updatedAt: ctx.normaliseTimestamp((model as { updatedAt?: unknown }).updatedAt) ?? Date.now()
        }
}

export function normaliseBucket(ctx: VisitsContext, value: unknown): VisitBucket {
        if (!ctx.isRecord(value)) {
            return ctx.createEmptyBucket()
        }

        const rawIps = ctx.isRecord(value.ips) ? value.ips : {}
        const ips: Record<string, VisitEntry> = {}
        let visits = 0

        for (const [rawIp, rawEntry] of Object.entries(rawIps)) {
            const ip = ctx.normaliseIp(rawIp)

            if (!ip) {
                continue
            }

            const entry = ctx.normaliseEntry(rawEntry)

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

export function normaliseEntry(ctx: VisitsContext, value: unknown): VisitEntry | undefined {
        if (!ctx.isRecord(value)) {
            return undefined
        }

        const rawTimestamps = Array.isArray(value.timestamps) ? value.timestamps : []
        const timestamps = rawTimestamps
            .map((item) => ctx.normaliseTimestamp(item))
            .filter((item): item is number => typeof item === "number")
            .sort((left, right) => left - right)
            .slice(-ctx.maxTimestampsPerIp)

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

export function readPages(ctx: VisitsContext, model: VisitsModelInput): Record<string, unknown> {
        const candidate = (model as { pages?: unknown }).pages

        return ctx.isRecord(candidate) ? candidate : {}
}

export function normaliseTimestamp(ctx: VisitsContext, value: unknown): UnixTimestampMs | undefined {
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

export function normaliseIp(ctx: VisitsContext, ip: string): string {
        const trimmed = ip.trim()

        if (!trimmed) {
            return ""
        }

        if (trimmed.startsWith("::ffff:")) {
            return trimmed.slice("::ffff:".length)
        }

        return trimmed
}

export function normalisePage(ctx: VisitsContext, page: string): string {
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

export function isRecord(ctx: VisitsContext, value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value)
}
