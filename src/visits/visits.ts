import type { VisitsContext } from "./context"
import type { UnixTimestampMs, VisitEntry, VisitBucket, VisitsModel, LegacyIsoTimestamp, LegacyVisitEntry, LegacyVisitBucket, LegacyVisitsModel, VisitsModelInput, VisitsStats, PageVisitsStats, PageVisitsLogResult, VisitsLogResult, VisitsStoreOptions, VisitsStorePaths, VisitsBackingStore } from "./types"

export function applyVisit(ctx: VisitsContext, 
        model: VisitsModel,
        ip: string,
        page: string,
        timestamp: UnixTimestampMs
    ): VisitsModel {
        const currentPage = model.pages[page] ?? ctx.createEmptyBucket()
        const nextPage = ctx.applyVisitToBucket(currentPage, ip, timestamp)

        return {
            pages: {
                ...model.pages,
                [page]: nextPage
            },
            updatedAt: timestamp
        }
}

export function applyVisitToBucket(ctx: VisitsContext, 
        bucket: VisitBucket,
        ip: string,
        timestamp: UnixTimestampMs
    ): VisitBucket {
        const existing = bucket.ips[ip]

        const nextEntry: VisitEntry = existing
            ? {
                count: existing.count + 1,
                timestamps: ctx.appendCapped(existing.timestamps, timestamp, ctx.maxTimestampsPerIp)
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

export function createEmptyBucket(ctx: VisitsContext): VisitBucket {
        return {
            visits: 0,
            ips: {}
        }
}

export function appendCapped(ctx: VisitsContext, list: number[], value: number, max: number): number[] {
        const next = [...list, value]
        const overflow = next.length - max

        if (overflow <= 0) {
            return next
        }

        return next.slice(overflow)
}
