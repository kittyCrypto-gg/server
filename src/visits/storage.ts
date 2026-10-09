import { MutexJsonStore } from "../mutexStore"
import { MutexProtoBuffStore } from "../mutexPBstore"
import { visitsProtoCodec } from "./schema"
import type { VisitsContext } from "./context"
import type { UnixTimestampMs, VisitEntry, VisitBucket, VisitsModel, LegacyIsoTimestamp, LegacyVisitEntry, LegacyVisitBucket, LegacyVisitsModel, VisitsModelInput, VisitsStats, PageVisitsStats, PageVisitsLogResult, VisitsLogResult, VisitsStoreOptions, VisitsStorePaths, VisitsBackingStore } from "./types"

export async function ensureMigrated(ctx: VisitsContext): Promise<void> {
        ctx.migrationPromise ??= ctx.migrateLegacyJsonIfNeeded()

        await ctx.migrationPromise
}

export async function migrateLegacyJsonIfNeeded(ctx: VisitsContext): Promise<void> {
        const protoBuffExists = await ctx.fileExists(ctx.protoBuffFilePath)

        if (protoBuffExists) {
            return
        }

        const legacyJsonExists = await ctx.fileExists(ctx.legacyJsonFilePath)

        if (!legacyJsonExists) {
            return
        }

        const legacyStore = ctx.createLegacyStore(ctx.legacyJsonFilePath)
        const legacyModel = ctx.normaliseModel(await legacyStore.read())

        await ctx.writeMigratedModel(legacyModel)
}

export async function writeMigratedModel(ctx: VisitsContext, legacyModel: VisitsModel): Promise<void> {
        await ctx.updateModel((current) => {
            const currentModel = ctx.normaliseModel(current)

            return ctx.hasStoredVisits(currentModel) ? currentModel : legacyModel
        })
}

export async function readNormalisedModel(ctx: VisitsContext): Promise<VisitsModel> {
        return ctx.normaliseModel(await ctx.readModel())
}

export async function updateNormalisedModel(ctx: VisitsContext, 
        update: (current: VisitsModel) => VisitsModel | Promise<VisitsModel>
    ): Promise<VisitsModel> {
        const next = await ctx.updateModel(async (current) => {
            const normalisedCurrent = ctx.normaliseModel(current)

            return await update(normalisedCurrent)
        })

        return ctx.normaliseModel(next)
}

export async function readModel(ctx: VisitsContext): Promise<VisitsModelInput> {
        return await ctx.store.read()
}

export async function updateModel(ctx: VisitsContext, 
        update: (current: VisitsModelInput) => VisitsModel | Promise<VisitsModel>
    ): Promise<VisitsModel> {
        return await ctx.store.update(async (current) => await update(current))
}

export function createStore(ctx: VisitsContext, filePath: string): VisitsBackingStore<VisitsModel> {
        return new MutexProtoBuffStore<VisitsModel>({
            filePath,
            lockTimeoutMs: ctx.lockTimeoutMs,
            lockRetryDelayMs: ctx.lockRetryDelayMs,
            initialValue: () => ctx.createInitialModel(),
            codec: visitsProtoCodec
        })
}

export function createLegacyStore(ctx: VisitsContext, filePath: string): VisitsBackingStore<VisitsModelInput> {
        return new MutexJsonStore<VisitsModelInput>({
            filePath,
            lockTimeoutMs: ctx.lockTimeoutMs,
            lockRetryDelayMs: ctx.lockRetryDelayMs,
            initialValue: () => ctx.createInitialModel()
        })
}

export function createInitialModel(ctx: VisitsContext): VisitsModel {
        return {
            pages: {},
            updatedAt: Date.now()
        }
}

export function hasStoredVisits(ctx: VisitsContext, model: VisitsModel): boolean {
        for (const bucket of Object.values(model.pages)) {
            if (bucket.visits > 0 || Object.keys(bucket.ips).length > 0) {
                return true
            }
        }

        return false
}
