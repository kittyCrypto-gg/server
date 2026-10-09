import type { UnixTimestampMs, VisitEntry, VisitBucket, VisitsModel, LegacyIsoTimestamp, LegacyVisitEntry, LegacyVisitBucket, LegacyVisitsModel, VisitsModelInput, VisitsStats, PageVisitsStats, PageVisitsLogResult, VisitsLogResult, VisitsStoreOptions, VisitsStorePaths, VisitsBackingStore } from "./visits/types"
import { visitsProtoCodec } from "./visits/schema"
import type { VisitsContext } from "./visits/context"
import { ensureMigrated as ensureMigrated_op, migrateLegacyJsonIfNeeded as migrateLegacyJsonIfNeeded_op, writeMigratedModel as writeMigratedModel_op, readNormalisedModel as readNormalisedModel_op, updateNormalisedModel as updateNormalisedModel_op, readModel as readModel_op, updateModel as updateModel_op, createStore as createStore_op, createLegacyStore as createLegacyStore_op, createInitialModel as createInitialModel_op, hasStoredVisits as hasStoredVisits_op } from "./visits/storage"
import { toStats as toStats_op, getOverallVisits as getOverallVisits_op, getOverallUniqueVisitors as getOverallUniqueVisitors_op, getOverallIpVisitCount as getOverallIpVisitCount_op, getOverallLastVisitAt as getOverallLastVisitAt_op } from "./visits/statistics"
import { applyVisit as applyVisit_op, applyVisitToBucket as applyVisitToBucket_op, createEmptyBucket as createEmptyBucket_op, appendCapped as appendCapped_op } from "./visits/visits"
import { normaliseModel as normaliseModel_op, normaliseBucket as normaliseBucket_op, normaliseEntry as normaliseEntry_op, readPages as readPages_op, normaliseTimestamp as normaliseTimestamp_op, normaliseIp as normaliseIp_op, normalisePage as normalisePage_op, isRecord as isRecord_op } from "./visits/normalisation"
import { resolveStorePaths as resolveStorePaths_op, replaceExtension as replaceExtension_op, fileExists as fileExists_op } from "./visits/paths"

export type { UnixTimestampMs, VisitEntry, VisitBucket, VisitsModel, LegacyIsoTimestamp, LegacyVisitEntry, LegacyVisitBucket, LegacyVisitsModel, VisitsModelInput, VisitsStats, PageVisitsStats, PageVisitsLogResult, VisitsLogResult, VisitsStoreOptions, VisitsStorePaths, VisitsBackingStore } from "./visits/types"
export { visitsProtoSchema, visitsProtoConversionOptions, visitsProtoCodec } from "./visits/schema"

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
        return ensureMigrated_op(this as unknown as VisitsContext);
    }

    protected async migrateLegacyJsonIfNeeded(): Promise<void> {
        return migrateLegacyJsonIfNeeded_op(this as unknown as VisitsContext);
    }

    protected async writeMigratedModel(legacyModel: VisitsModel): Promise<void> {
        return writeMigratedModel_op(this as unknown as VisitsContext, legacyModel);
    }

    protected async readNormalisedModel(): Promise<VisitsModel> {
        return readNormalisedModel_op(this as unknown as VisitsContext);
    }

    protected async updateNormalisedModel(
        update: (current: VisitsModel) => VisitsModel | Promise<VisitsModel>
    ): Promise<VisitsModel> {
        return updateNormalisedModel_op(this as unknown as VisitsContext, update);
    }

    protected async readModel(): Promise<VisitsModelInput> {
        return readModel_op(this as unknown as VisitsContext);
    }

    protected async updateModel(
        update: (current: VisitsModelInput) => VisitsModel | Promise<VisitsModel>
    ): Promise<VisitsModel> {
        return updateModel_op(this as unknown as VisitsContext, update);
    }

    protected createStore(filePath: string): VisitsBackingStore<VisitsModel> {
        return createStore_op(this as unknown as VisitsContext, filePath);
    }

    protected createLegacyStore(filePath: string): VisitsBackingStore<VisitsModelInput> {
        return createLegacyStore_op(this as unknown as VisitsContext, filePath);
    }

    protected createInitialModel(): VisitsModel {
        return createInitialModel_op(this as unknown as VisitsContext);
    }

    protected toStats(model: VisitsModel): VisitsStats {
        return toStats_op(this as unknown as VisitsContext, model);
    }

    protected applyVisit(
        model: VisitsModel,
        ip: string,
        page: string,
        timestamp: UnixTimestampMs
    ): VisitsModel {
        return applyVisit_op(this as unknown as VisitsContext, model, ip, page, timestamp);
    }

    protected applyVisitToBucket(
        bucket: VisitBucket,
        ip: string,
        timestamp: UnixTimestampMs
    ): VisitBucket {
        return applyVisitToBucket_op(this as unknown as VisitsContext, bucket, ip, timestamp);
    }

    protected normaliseModel(model: VisitsModelInput): VisitsModel {
        return normaliseModel_op(this as unknown as VisitsContext, model);
    }

    protected normaliseBucket(value: unknown): VisitBucket {
        return normaliseBucket_op(this as unknown as VisitsContext, value);
    }

    protected normaliseEntry(value: unknown): VisitEntry | undefined {
        return normaliseEntry_op(this as unknown as VisitsContext, value);
    }

    protected getOverallVisits(model: VisitsModel): number {
        return getOverallVisits_op(this as unknown as VisitsContext, model);
    }

    protected getOverallUniqueVisitors(model: VisitsModel): number {
        return getOverallUniqueVisitors_op(this as unknown as VisitsContext, model);
    }

    protected getOverallIpVisitCount(model: VisitsModel, ip: string): number {
        return getOverallIpVisitCount_op(this as unknown as VisitsContext, model, ip);
    }

    protected getOverallLastVisitAt(model: VisitsModel, ip: string): UnixTimestampMs | undefined {
        return getOverallLastVisitAt_op(this as unknown as VisitsContext, model, ip);
    }

    protected createEmptyBucket(): VisitBucket {
        return createEmptyBucket_op(this as unknown as VisitsContext);
    }

    protected readPages(model: VisitsModelInput): Record<string, unknown> {
        return readPages_op(this as unknown as VisitsContext, model);
    }

    protected appendCapped(list: number[], value: number, max: number): number[] {
        return appendCapped_op(this as unknown as VisitsContext, list, value, max);
    }

    protected normaliseTimestamp(value: unknown): UnixTimestampMs | undefined {
        return normaliseTimestamp_op(this as unknown as VisitsContext, value);
    }

    protected normaliseIp(ip: string): string {
        return normaliseIp_op(this as unknown as VisitsContext, ip);
    }

    protected normalisePage(page: string): string {
        return normalisePage_op(this as unknown as VisitsContext, page);
    }

    protected hasStoredVisits(model: VisitsModel): boolean {
        return hasStoredVisits_op(this as unknown as VisitsContext, model);
    }

    protected resolveStorePaths(filePath: string | undefined): VisitsStorePaths {
        return resolveStorePaths_op(this as unknown as VisitsContext, filePath);
    }

    protected replaceExtension(filePath: string, extension: string): string {
        return replaceExtension_op(this as unknown as VisitsContext, filePath, extension);
    }

    protected async fileExists(filePath: string): Promise<boolean> {
        return fileExists_op(this as unknown as VisitsContext, filePath);
    }

    protected isRecord(value: unknown): value is Record<string, unknown> {
        return isRecord_op(this as unknown as VisitsContext, value);
    }
}
