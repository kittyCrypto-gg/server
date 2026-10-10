import { promises as fs } from "fs";
import path from "path";

type NodeErrorWithCode = Error & { code?: string };

/** Shared pure mapping. Caller retains original default/whitespace policy. */
export function protoAndJsonPaths(
    resolvedFilePath: string,
    replace: (filePath: string, extension: string) => string
): { protoBuffFilePath: string; legacyJsonFilePath: string } {
    const extension = path.extname(resolvedFilePath).toLowerCase();

    if (extension === ".json") {
        return {
            protoBuffFilePath: replace(resolvedFilePath, ".pb"),
            legacyJsonFilePath: resolvedFilePath
        };
    }

    if (extension === ".pb") {
        return {
            protoBuffFilePath: resolvedFilePath,
            legacyJsonFilePath: replace(resolvedFilePath, ".json")
        };
    }

    return {
        protoBuffFilePath: `${resolvedFilePath}.pb`,
        legacyJsonFilePath: `${resolvedFilePath}.json`
    };
}

export function replaceStoreExtension(filePath: string, extension: string): string {
    const parsed = path.parse(filePath);
    return path.join(parsed.dir, `${parsed.name}${extension}`);
}

/** Token-store legacy treats ENOTDIR as missing; visits/rate-limit do not. */
export async function storeFileExists(filePath: string, missingParentIsMissing = false): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (err: unknown) {
        const code = (err as NodeErrorWithCode).code;
        if (code === "ENOENT") return false;
        if (missingParentIsMissing && code === "ENOTDIR") return false;
        throw err;
    }
}
