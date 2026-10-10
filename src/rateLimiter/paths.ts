import path from "path";
import type { RateLimiterStorePaths } from "./types";
import { protoAndJsonPaths, replaceStoreExtension, storeFileExists } from "../storagePaths";

export function resolveStorePaths(filePath: string | undefined): RateLimiterStorePaths {
    const resolvedFilePath = filePath?.trim() || path.resolve(process.cwd(), "data", "rateLimits.pb");
    return protoAndJsonPaths(resolvedFilePath, replaceExtension);
}

export function replaceExtension(filePath: string, extension: string): string {
    return replaceStoreExtension(filePath, extension);
}

export async function fileExists(filePath: string): Promise<boolean> {
    return await storeFileExists(filePath);
}
