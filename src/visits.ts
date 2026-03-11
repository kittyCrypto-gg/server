import { MutexJsonStore } from './mutexJsonStore'
import * as path from 'path'

type IsoTimestamp = string

type VisitsModel = {
    visits: number
    ips: Record<string, { count: number; timestamps: IsoTimestamp[] }>
    updatedAt: IsoTimestamp
}

export type VisitsStats = {
    visits: number
    uniqueVisitors: number
    updatedAt: IsoTimestamp
}

export type VisitsLogResult = VisitsStats & {
    ip: string
    ipVisitCount: number
    lastVisitAt: IsoTimestamp
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
                updatedAt: new Date().toISOString()
            })
        })
    }

    public async getStats(): Promise<VisitsStats> {
        const model = await this.store.read()
        return this.toStats(model)
    }

    public async logVisit(ip: string, at: Date = new Date()): Promise<VisitsLogResult> {
        const normalisedIp = this.normaliseIp(ip)
        if (!normalisedIp) {
            throw new Error('VisitsStore.logVisit requires a non-empty ip string')
        }

        const timestamp = at.toISOString()

        const next = await this.store.update((current) => this.applyVisit(current, normalisedIp, timestamp))

        const entry = next.ips[normalisedIp]
        return {
            ...this.toStats(next),
            ip: normalisedIp,
            ipVisitCount: entry.count,
            lastVisitAt: entry.timestamps[entry.timestamps.length - 1] ?? timestamp
        }
    }

    private toStats(model: VisitsModel): VisitsStats {
        return {
            visits: model.visits,
            uniqueVisitors: Object.keys(model.ips).length,
            updatedAt: model.updatedAt
        }
    }

    private applyVisit(model: VisitsModel, ip: string, timestamp: IsoTimestamp): VisitsModel {
        const existing = model.ips[ip]

        const nextEntry = existing
            ? {
                count: existing.count + 1,
                timestamps: this.appendCapped(existing.timestamps, timestamp, this.maxTimestampsPerIp)
            }
            : {
                count: 1,
                timestamps: [timestamp]
            }

        return {
            visits: model.visits + 1,
            ips: {
                ...model.ips,
                [ip]: nextEntry
            },
            updatedAt: timestamp
        }
    }

    private appendCapped(list: string[], value: string, max: number): string[] {
        const next = [...list, value]
        const overflow = next.length - max
        if (overflow <= 0) return next
        return next.slice(overflow)
    }

    private normaliseIp(ip: string): string {
        const trimmed = ip.trim()
        if (trimmed.startsWith('::ffff:')) return trimmed.slice('::ffff:'.length)
        return trimmed
    }
}