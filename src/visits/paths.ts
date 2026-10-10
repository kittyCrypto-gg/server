import * as path from "path";
import type { VisitsContext } from "./context";
import type { VisitsStorePaths } from "./types";
import { protoAndJsonPaths, replaceStoreExtension, storeFileExists } from "../storagePaths";

export function resolveStorePaths(ctx: VisitsContext, filePath: string | undefined): VisitsStorePaths {
    const resolvedFilePath = filePath ?? path.resolve(process.cwd(), "data", "visits.pb");
    return protoAndJsonPaths(resolvedFilePath, (file, ext) => ctx.replaceExtension(file, ext));
}

export function replaceExtension(ctx: VisitsContext, filePath: string, extension: string): string {
    return replaceStoreExtension(filePath, extension);
}

export async function fileExists(ctx: VisitsContext, filePath: string): Promise<boolean> {
    return await storeFileExists(filePath);
}
