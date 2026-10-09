import { VisitsStore, visitsProtoCodec, visitsProtoSchema, visitsProtoConversionOptions,
    type UnixTimestampMs, type VisitEntry, type VisitBucket, type VisitsModel,
    type LegacyIsoTimestamp, type LegacyVisitEntry, type LegacyVisitBucket,
    type LegacyVisitsModel, type VisitsModelInput, type VisitsStats,
    type PageVisitsStats, type PageVisitsLogResult, type VisitsLogResult,
    type VisitsStoreOptions, type VisitsStorePaths, type VisitsBackingStore
} from "../visits"
import { ExtVisitsStore } from "../extVisits"
import type { ProtoBuffCodec } from "../mutexPBstore"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T
type Ctor = Assert<Equal<ConstructorParameters<typeof VisitsStore>, [options?: VisitsStoreOptions]>>
type ReadAll = Assert<Equal<ReturnType<VisitsStore["getStats"]>, Promise<VisitsStats>>>
type ReadPage = Assert<Equal<ReturnType<VisitsStore["getPageStats"]>, Promise<PageVisitsStats>>>
type VisitReturn = Assert<Equal<ReturnType<VisitsStore["logVisit"]>, Promise<VisitsLogResult>>>
type Codable = Assert<Equal<typeof visitsProtoCodec, ProtoBuffCodec<VisitsModel>>>
type Stamp = Assert<Equal<UnixTimestampMs, number>>
type LegacyStamp = Assert<Equal<LegacyIsoTimestamp, string>>

class ExternalSubclass extends VisitsStore {
    public auditProtectedExtensions(): void {
        void this.maxTimestampsPerIp
        void this.protoBuffFilePath
        void this.legacyJsonFilePath
        void this.lockTimeoutMs
        void this.lockRetryDelayMs
        void this.store
        void this.migrationPromise
        void this.ensureMigrated()
        void this.readNormalisedModel()
        void this.updateNormalisedModel(async current => current)
        void this.readModel()
        void this.updateModel(async current => this.normaliseModel(current))
        void this.createStore("example.pb")
        void this.createLegacyStore("example.json")
        void this.createInitialModel()
        void this.toStats({ pages: {}, updatedAt: 1 })
        void this.getOverallVisits({ pages: {}, updatedAt: 1 })
        void this.getOverallUniqueVisitors({ pages: {}, updatedAt: 1 })
        void this.getOverallIpVisitCount({ pages: {}, updatedAt: 1 }, "127.0.0.1")
        void this.getOverallLastVisitAt({ pages: {}, updatedAt: 1 }, "127.0.0.1")
        void this.createEmptyBucket()
        void this.normalisePage("/")
        void this.normaliseIp("127.0.0.1")
        void this.resolveStorePaths("example.pb")
        void this.replaceExtension("example.pb", ".json")
        void this.fileExists("example.pb")
    }
}

export function existingConsumer(options: VisitsStoreOptions): VisitsStore {
    const model = new VisitsStore(options)
    void model.getStats()
    void model.getPageStats("/")
    void model.logVisit("127.0.0.1", "/")
    void new ExtVisitsStore(options)
    void visitsProtoCodec
    void visitsProtoSchema
    void visitsProtoConversionOptions
    return model
}
export type VisitsStoreContract = Ctor | ReadAll | ReadPage | VisitReturn | Codable | Stamp | LegacyStamp |
    VisitEntry | VisitBucket | VisitsModelInput | LegacyVisitEntry | LegacyVisitBucket | LegacyVisitsModel |
    PageVisitsLogResult | VisitsStorePaths | VisitsBackingStore<VisitsModel> | ExternalSubclass
