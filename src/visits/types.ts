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
