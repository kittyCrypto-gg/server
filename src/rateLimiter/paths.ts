import { promises as fs } from "fs";
import path from "path";
import type { RateLimiterStorePaths, NodeErrorWithCode } from "./types";


export function resolveStorePaths(filePath: string | undefined): RateLimiterStorePaths {
    const resolvedFilePath = filePath?.trim() || path.resolve(process.cwd(), "data", "rateLimits.pb");
    const extension = path.extname(resolvedFilePath).toLowerCase();

    if (extension === ".json") {
        return {
            protoBuffFilePath: replaceExtension(resolvedFilePath, ".pb"),
            legacyJsonFilePath: resolvedFilePath
        };
    }

    if (extension === ".pb") {
        return {
            protoBuffFilePath: resolvedFilePath,
            legacyJsonFilePath: replaceExtension(resolvedFilePath, ".json")
        };
    }

    return {
        protoBuffFilePath: `${resolvedFilePath}.pb`,
        legacyJsonFilePath: `${resolvedFilePath}.json`
    };
}

export function replaceExtension(filePath: string, extension: string): string {
    const parsed = path.parse(filePath);

    return path.join(parsed.dir, `${parsed.name}${extension}`);
}

export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);

        return true;
    } catch (err: unknown) {
        const code = (err as NodeErrorWithCode).code;

        if (code === "ENOENT") {
            return false;
        }

        throw err;
    }
}
