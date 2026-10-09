import type { VisitsContext } from "./context"
import type { UnixTimestampMs, VisitEntry, VisitBucket, VisitsModel, LegacyIsoTimestamp, LegacyVisitEntry, LegacyVisitBucket, LegacyVisitsModel, VisitsModelInput, VisitsStats, PageVisitsStats, PageVisitsLogResult, VisitsLogResult, VisitsStoreOptions, VisitsStorePaths, VisitsBackingStore } from "./types"

export function toStats(ctx: VisitsContext, model: VisitsModel): VisitsStats {
        return {
            visits: ctx.getOverallVisits(model),
            uniqueVisitors: ctx.getOverallUniqueVisitors(model),
            updatedAt: model.updatedAt
        }
}

export function getOverallVisits(ctx: VisitsContext, model: VisitsModel): number {
        let visits = 0

        for (const bucket of Object.values(model.pages)) {
            visits += bucket.visits
        }

        return visits
}

export function getOverallUniqueVisitors(ctx: VisitsContext, model: VisitsModel): number {
        const uniqueIps = new Set<string>()

        for (const bucket of Object.values(model.pages)) {
            for (const ip of Object.keys(bucket.ips)) {
                uniqueIps.add(ip)
            }
        }

        return uniqueIps.size
}

export function getOverallIpVisitCount(ctx: VisitsContext, model: VisitsModel, ip: string): number {
        let count = 0

        for (const bucket of Object.values(model.pages)) {
            count += bucket.ips[ip]?.count ?? 0
        }

        return count
}

export function getOverallLastVisitAt(ctx: VisitsContext, model: VisitsModel, ip: string): UnixTimestampMs | undefined {
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
