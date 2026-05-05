import { promises as fs } from "fs"
import * as path from "path"
import * as protobuf from "protobufjs"
import type { IConversionOptions } from "protobufjs"
import { MutexJsonStore } from "./mutexStore"
import { MutexProtoBuffStore, ProtoBuffCodec } from "./mutexPBstore"

type NodeErrorWithCode = Error & { code?: string }

export type UnixTimestampMs = number

export type VisitEntry = {
    count: number
    timestamps: UnixTimestampMs[]
}

export type VisitBucket = {
    visits: number
    ips: Record<string, VisitEntry>
}

export type VisitsModel = {
    pages: Record<string, VisitBucket>
    updatedAt: UnixTimestampMs
}

export type LegacyIsoTimestamp = string

export type LegacyVisitEntry = {
    count: number
    timestamps: LegacyIsoTimestamp[]
}

export type LegacyVisitBucket = {
    visits: number
    ips: Record<string, LegacyVisitEntry>
}

export type LegacyVisitsModel = LegacyVisitBucket & {
    pages: Record<string, LegacyVisitBucket>
    updatedAt: LegacyIsoTimestamp | UnixTimestampMs
}

export type VisitsModelInput = VisitsModel | LegacyVisitsModel

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

export type VisitsStoreOptions = {
    filePath?: string
    maxTimestampsPerIp?: number
    lockTimeoutMs?: number
    lockRetryDelayMs?: number
}

export type VisitsStorePaths = {
    protoBuffFilePath: string
    legacyJsonFilePath: string
}

export type VisitsBackingStore<TModel> = {
    read: () => Promise<TModel>
    update: (update: (current: TModel) => TModel | Promise<TModel>) => Promise<TModel>
}

export const visitsProtoSchema = `
syntax = "proto3";

message VisitEntry {
    uint64 count = 1;
    repeated int64 timestamps = 2;
}

message VisitBucket {
    uint64 visits = 1;
    map<string, VisitEntry> ips = 2;
}

message VisitsModel {
    map<string, VisitBucket> pages = 1;
    int64 updatedAt = 2;
}
`

const visitsProtoRoot = protobuf.parse(visitsProtoSchema).root
const visitsMessageType = visitsProtoRoot.lookupType("VisitsModel")

export const visitsProtoConversionOptions: IConversionOptions = {
    longs: Number,
    enums: String,
    defaults: true,
    arrays: true,
    objects: true
}

export const visitsProtoCodec: ProtoBuffCodec<VisitsModel> = {
    encode: (value: VisitsModel): Buffer => {
        const validationError = visitsMessageType.verify(value)

        if (validationError !== null) {
            throw new Error(`VisitsStore cannot encode invalid protobuf payload: ${validationError}`)
        }

        const message = visitsMessageType.fromObject(value)
        const encoded = visitsMessageType.encode(message).finish()

        return Buffer.from(encoded)
    },

    decode: (raw: Buffer): VisitsModel => {
        const message = visitsMessageType.decode(raw)
        const plainObject = visitsMessageType.toObject(message, visitsProtoConversionOptions)

        return plainObject as VisitsModel
    }
}

export class VisitsStore {
    protected readonly maxTimestampsPerIp: number
    protected readonly protoBuffFilePath: string
    protected readonly legacyJsonFilePath: string
    protected readonly lockTimeoutMs?: number
    protected readonly lockRetryDelayMs?: number
    protected readonly store: VisitsBackingStore<VisitsModel>
    protected migrationPromise?: Promise<void>

    public constructor(options: VisitsStoreOptions = {}) {
        const storePaths = this.resolveStorePaths(options.filePath)

        this.maxTimestampsPerIp = options.maxTimestampsPerIp ?? 50
        this.protoBuffFilePath = storePaths.protoBuffFilePath
        this.legacyJsonFilePath = storePaths.legacyJsonFilePath
        this.lockTimeoutMs = options.lockTimeoutMs
        this.lockRetryDelayMs = options.lockRetryDelayMs
        this.store = this.createStore(this.protoBuffFilePath)
    }

    public async getStats(): Promise<VisitsStats> {
        await this.ensureMigrated()

        const model = await this.readNormalisedModel()

        return this.toStats(model)
    }

    public async getPageStats(page: string): Promise<PageVisitsStats> {
        await this.ensureMigrated()

        const normalisedPage = this.normalisePage(page)

        if (!normalisedPage) {
            throw new Error("VisitsStore.getPageStats requires a non-empty page string")
        }

        const model = await this.readNormalisedModel()
        const pageBucket = model.pages[normalisedPage] ?? this.createEmptyBucket()

        return {
            page: normalisedPage,
            visits: pageBucket.visits,
            uniqueVisitors: Object.keys(pageBucket.ips).length,
            updatedAt: model.updatedAt
        }
    }

    public async logVisit(ip: string, page: string, at: Date = new Date()): Promise<VisitsLogResult> {
        await this.ensureMigrated()

        const normalisedIp = this.normaliseIp(ip)
        const normalisedPage = this.normalisePage(page)

        if (!normalisedIp) {
            throw new Error("VisitsStore.logVisit requires a non-empty ip string")
        }

        if (!normalisedPage) {
            throw new Error("VisitsStore.logVisit requires a non-empty page string")
        }

        const timestamp = at.getTime()

        const next = await this.updateNormalisedModel((current) =>
            this.applyVisit(current, normalisedIp, normalisedPage, timestamp)
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

    protected async ensureMigrated(): Promise<void> {
        this.migrationPromise ??= this.migrateLegacyJsonIfNeeded()

        await this.migrationPromise
    }

    protected async migrateLegacyJsonIfNeeded(): Promise<void> {
        const protoBuffExists = await this.fileExists(this.protoBuffFilePath)

        if (protoBuffExists) {
            return
        }

        const legacyJsonExists = await this.fileExists(this.legacyJsonFilePath)

        if (!legacyJsonExists) {
            return
        }

        const legacyStore = this.createLegacyStore(this.legacyJsonFilePath)
        const legacyModel = this.normaliseModel(await legacyStore.read())

        await this.writeMigratedModel(legacyModel)
    }

    protected async writeMigratedModel(legacyModel: VisitsModel): Promise<void> {
        await this.updateModel((current) => {
            const currentModel = this.normaliseModel(current)

            return this.hasStoredVisits(currentModel) ? currentModel : legacyModel
        })
    }

    protected async readNormalisedModel(): Promise<VisitsModel> {
        return this.normaliseModel(await this.readModel())
    }

    protected async updateNormalisedModel(
        update: (current: VisitsModel) => VisitsModel | Promise<VisitsModel>
    ): Promise<VisitsModel> {
        const next = await this.updateModel(async (current) => {
            const normalisedCurrent = this.normaliseModel(current)

            return await update(normalisedCurrent)
        })

        return this.normaliseModel(next)
    }

    protected async readModel(): Promise<VisitsModelInput> {
        return await this.store.read()
    }

    protected async updateModel(
        update: (current: VisitsModelInput) => VisitsModel | Promise<VisitsModel>
    ): Promise<VisitsModel> {
        return await this.store.update(async (current) => await update(current))
    }

    protected createStore(filePath: string): VisitsBackingStore<VisitsModel> {
        return new MutexProtoBuffStore<VisitsModel>({
            filePath,
            lockTimeoutMs: this.lockTimeoutMs,
            lockRetryDelayMs: this.lockRetryDelayMs,
            initialValue: () => this.createInitialModel(),
            codec: visitsProtoCodec
        })
    }

    protected createLegacyStore(filePath: string): VisitsBackingStore<VisitsModelInput> {
        return new MutexJsonStore<VisitsModelInput>({
            filePath,
            lockTimeoutMs: this.lockTimeoutMs,
            lockRetryDelayMs: this.lockRetryDelayMs,
            initialValue: () => this.createInitialModel()
        })
    }

    protected createInitialModel(): VisitsModel {
        return {
            pages: {},
            updatedAt: Date.now()
        }
    }

    protected toStats(model: VisitsModel): VisitsStats {
        return {
            visits: this.getOverallVisits(model),
            uniqueVisitors: this.getOverallUniqueVisitors(model),
            updatedAt: model.updatedAt
        }
    }

    protected applyVisit(
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

    protected applyVisitToBucket(
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

    protected normaliseModel(model: VisitsModelInput): VisitsModel {
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

    protected normaliseBucket(value: unknown): VisitBucket {
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

    protected normaliseEntry(value: unknown): VisitEntry | undefined {
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

    protected getOverallVisits(model: VisitsModel): number {
        let visits = 0

        for (const bucket of Object.values(model.pages)) {
            visits += bucket.visits
        }

        return visits
    }

    protected getOverallUniqueVisitors(model: VisitsModel): number {
        const uniqueIps = new Set<string>()

        for (const bucket of Object.values(model.pages)) {
            for (const ip of Object.keys(bucket.ips)) {
                uniqueIps.add(ip)
            }
        }

        return uniqueIps.size
    }

    protected getOverallIpVisitCount(model: VisitsModel, ip: string): number {
        let count = 0

        for (const bucket of Object.values(model.pages)) {
            count += bucket.ips[ip]?.count ?? 0
        }

        return count
    }

    protected getOverallLastVisitAt(model: VisitsModel, ip: string): UnixTimestampMs | undefined {
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

    protected createEmptyBucket(): VisitBucket {
        return {
            visits: 0,
            ips: {}
        }
    }

    protected readPages(model: VisitsModelInput): Record<string, unknown> {
        const candidate = (model as { pages?: unknown }).pages

        return this.isRecord(candidate) ? candidate : {}
    }

    protected appendCapped(list: number[], value: number, max: number): number[] {
        const next = [...list, value]
        const overflow = next.length - max

        if (overflow <= 0) {
            return next
        }

        return next.slice(overflow)
    }

    protected normaliseTimestamp(value: unknown): UnixTimestampMs | undefined {
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

    protected normaliseIp(ip: string): string {
        const trimmed = ip.trim()

        if (!trimmed) {
            return ""
        }

        if (trimmed.startsWith("::ffff:")) {
            return trimmed.slice("::ffff:".length)
        }

        return trimmed
    }

    protected normalisePage(page: string): string {
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

    protected hasStoredVisits(model: VisitsModel): boolean {
        for (const bucket of Object.values(model.pages)) {
            if (bucket.visits > 0 || Object.keys(bucket.ips).length > 0) {
                return true
            }
        }

        return false
    }

    protected resolveStorePaths(filePath: string | undefined): VisitsStorePaths {
        const resolvedFilePath = filePath ?? path.resolve(process.cwd(), "data", "visits.pb")
        const extension = path.extname(resolvedFilePath).toLowerCase()

        if (extension === ".json") {
            return {
                protoBuffFilePath: this.replaceExtension(resolvedFilePath, ".pb"),
                legacyJsonFilePath: resolvedFilePath
            }
        }

        if (extension === ".pb") {
            return {
                protoBuffFilePath: resolvedFilePath,
                legacyJsonFilePath: this.replaceExtension(resolvedFilePath, ".json")
            }
        }

        return {
            protoBuffFilePath: `${resolvedFilePath}.pb`,
            legacyJsonFilePath: `${resolvedFilePath}.json`
        }
    }

    protected replaceExtension(filePath: string, extension: string): string {
        const parsed = path.parse(filePath)

        return path.join(parsed.dir, `${parsed.name}${extension}`)
    }

    protected async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath)

            return true
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code

            if (code === "ENOENT") {
                return false
            }

            throw err
        }
    }

    protected isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value)
    }
}