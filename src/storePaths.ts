import { promises as fs } from "node:fs";
import path from "node:path";

/** Shared filesystem policy; storage modules keep their historical entrypoints. */
export interface ProtoJsonStorePaths {
    protoBuffFilePath: string;
    legacyJsonFilePath: string;
}

export interface ProtoJsonPathPolicy {
    defaultFilePath: string;
    trimProvidedPath: boolean;
    replaceExtension: (filePath: string, extension: string) => string;
}

export function resolveProtoJsonStorePaths(
    filePath: string | undefined,
    policy: ProtoJsonPathPolicy,
): ProtoJsonStorePaths {
    const selected = policy.trimProvidedPath ? filePath?.trim() || policy.defaultFilePath : filePath ?? policy.defaultFilePath;
    const extension = path.extname(selected).toLowerCase();

    if (extension === ".json") {
        return { protoBuffFilePath: policy.replaceExtension(selected, ".pb"), legacyJsonFilePath: selected };
    }
    if (extension === ".pb") {
        return { protoBuffFilePath: selected, legacyJsonFilePath: policy.replaceExtension(selected, ".json") };
    }
    return { protoBuffFilePath: `${selected}.pb`, legacyJsonFilePath: `${selected}.json` };
}

export function replaceFileExtension(filePath: string, extension: string): string {
    const parsed = path.parse(filePath);
    return path.join(parsed.dir, `${parsed.name}${extension}`);
}

/** Keep ENOTDIR optional: token sessions historically tolerate it; visits/rate limiters do not. */
export async function storeFileExists(
    filePath: string,
    notFoundCodes: readonly string[] = ["ENOENT"],
): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error: unknown) {
        const code = (error as Error & { code?: string }).code;
        if (code !== undefined && notFoundCodes.includes(code)) return false;
        throw error;
    }
}
