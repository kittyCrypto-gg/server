import type { UnixTimestampMs, VisitEntry, VisitBucket, VisitsModel, LegacyIsoTimestamp, LegacyVisitEntry, LegacyVisitBucket, LegacyVisitsModel, VisitsModelInput, VisitsStats, PageVisitsStats, PageVisitsLogResult, VisitsLogResult, VisitsStoreOptions, VisitsStorePaths, VisitsBackingStore } from "./types"

/** Internal view of VisitsStore, including extension points used by ExtVisitsStore. */
export interface VisitsContext {
    readonly maxTimestampsPerIp: number
    readonly protoBuffFilePath: string
    readonly legacyJsonFilePath: string
    readonly lockTimeoutMs?: number
    readonly lockRetryDelayMs?: number
    readonly store: VisitsBackingStore<VisitsModel>
    migrationPromise?: Promise<void>
    getStats(): Promise<VisitsStats>;
    getPageStats(page: string): Promise<PageVisitsStats>;
    logVisit(ip: string, page: string, at?: Date): Promise<VisitsLogResult>;
    ensureMigrated(): Promise<void>;
    migrateLegacyJsonIfNeeded(): Promise<void>;
    writeMigratedModel(legacyModel: VisitsModel): Promise<void>;
    readNormalisedModel(): Promise<VisitsModel>;
    updateNormalisedModel(
        update: (current: VisitsModel) => VisitsModel | Promise<VisitsModel>
    ): Promise<VisitsModel>;
    readModel(): Promise<VisitsModelInput>;
    updateModel(
        update: (current: VisitsModelInput) => VisitsModel | Promise<VisitsModel>
    ): Promise<VisitsModel>;
    createStore(filePath: string): VisitsBackingStore<VisitsModel>;
    createLegacyStore(filePath: string): VisitsBackingStore<VisitsModelInput>;
    createInitialModel(): VisitsModel;
    toStats(model: VisitsModel): VisitsStats;
    applyVisit(
        model: VisitsModel,
        ip: string,
        page: string,
        timestamp: UnixTimestampMs
    ): VisitsModel;
    applyVisitToBucket(
        bucket: VisitBucket,
        ip: string,
        timestamp: UnixTimestampMs
    ): VisitBucket;
    normaliseModel(model: VisitsModelInput): VisitsModel;
    normaliseBucket(value: unknown): VisitBucket;
    normaliseEntry(value: unknown): VisitEntry | undefined;
    getOverallVisits(model: VisitsModel): number;
    getOverallUniqueVisitors(model: VisitsModel): number;
    getOverallIpVisitCount(model: VisitsModel, ip: string): number;
    getOverallLastVisitAt(model: VisitsModel, ip: string): UnixTimestampMs | undefined;
    createEmptyBucket(): VisitBucket;
    readPages(model: VisitsModelInput): Record<string, unknown>;
    appendCapped(list: number[], value: number, max: number): number[];
    normaliseTimestamp(value: unknown): UnixTimestampMs | undefined;
    normaliseIp(ip: string): string;
    normalisePage(page: string): string;
    hasStoredVisits(model: VisitsModel): boolean;
    resolveStorePaths(filePath: string | undefined): VisitsStorePaths;
    replaceExtension(filePath: string, extension: string): string;
    fileExists(filePath: string): Promise<boolean>;
    isRecord(value: unknown): value is Record<string, unknown>;
}
