import { promises as fs } from "fs"
import * as path from "path"

type NodeErrorWithCode = Error & { code?: string }
import type { VisitsContext } from "./context"
import type { UnixTimestampMs, VisitEntry, VisitBucket, VisitsModel, LegacyIsoTimestamp, LegacyVisitEntry, LegacyVisitBucket, LegacyVisitsModel, VisitsModelInput, VisitsStats, PageVisitsStats, PageVisitsLogResult, VisitsLogResult, VisitsStoreOptions, VisitsStorePaths, VisitsBackingStore } from "./types"

export function resolveStorePaths(ctx: VisitsContext, filePath: string | undefined): VisitsStorePaths {
        const resolvedFilePath = filePath ?? path.resolve(process.cwd(), "data", "visits.pb")
        const extension = path.extname(resolvedFilePath).toLowerCase()

        if (extension === ".json") {
            return {
                protoBuffFilePath: ctx.replaceExtension(resolvedFilePath, ".pb"),
                legacyJsonFilePath: resolvedFilePath
            }
        }

        if (extension === ".pb") {
            return {
                protoBuffFilePath: resolvedFilePath,
                legacyJsonFilePath: ctx.replaceExtension(resolvedFilePath, ".json")
            }
        }

        return {
            protoBuffFilePath: `${resolvedFilePath}.pb`,
            legacyJsonFilePath: `${resolvedFilePath}.json`
        }
}

export function replaceExtension(ctx: VisitsContext, filePath: string, extension: string): string {
        const parsed = path.parse(filePath)

        return path.join(parsed.dir, `${parsed.name}${extension}`)
}

export async function fileExists(ctx: VisitsContext, filePath: string): Promise<boolean> {
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
