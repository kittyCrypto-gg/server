import path from "node:path";
import type { RateLimiterStorePaths } from "./types";
import { resolveProtoJsonStorePaths, replaceFileExtension, storeFileExists } from "../storePaths";

export function resolveStorePaths(filePath: string | undefined): RateLimiterStorePaths {
    return resolveProtoJsonStorePaths(filePath, {
        defaultFilePath: path.resolve(process.cwd(), "data", "rateLimits.pb"),
        trimProvidedPath: true,
        replaceExtension
    });
}

export function replaceExtension(filePath: string, extension: string): string {
    return replaceFileExtension(filePath, extension);
}

export async function fileExists(filePath: string): Promise<boolean> {
    return storeFileExists(filePath);
}
