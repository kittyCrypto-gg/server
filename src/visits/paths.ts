import path from "node:path";
import type { VisitsContext } from "./context";
import type { VisitsStorePaths } from "./types";
import { resolveProtoJsonStorePaths, replaceFileExtension, storeFileExists } from "../storePaths";

export function resolveStorePaths(ctx: VisitsContext, filePath: string | undefined): VisitsStorePaths {
    return resolveProtoJsonStorePaths(filePath, {
        defaultFilePath: path.resolve(process.cwd(), "data", "visits.pb"),
        trimProvidedPath: false,
        replaceExtension: (candidate, ext) => ctx.replaceExtension(candidate, ext)
    });
}

export function replaceExtension(ctx: VisitsContext, filePath: string, extension: string): string {
    return replaceFileExtension(filePath, extension);
}

export async function fileExists(ctx: VisitsContext, filePath: string): Promise<boolean> {
    return storeFileExists(filePath);
}
