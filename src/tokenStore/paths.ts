import { promises as fs } from "fs";
import path from "path";
import type { TokenStorePaths } from "./types";
type NodeErrorWithCode = Error & { code?: string };
import type { TokenStoreContext } from "./context";

export function resolveStorePaths(ctx: TokenStoreContext, filePath: string | undefined): TokenStorePaths {
        const resolvedFilePath = filePath?.trim() || path.resolve(process.cwd(), "data", "sessionTokens.pb");
        const extension = path.extname(resolvedFilePath).toLowerCase();

        if (extension === ".json") {
            return {
                protoBuffFilePath: ctx.replaceExtension(resolvedFilePath, ".pb"),
                legacyJsonFilePath: resolvedFilePath
            };
        }

        if (extension === ".pb") {
            return {
                protoBuffFilePath: resolvedFilePath,
                legacyJsonFilePath: ctx.replaceExtension(resolvedFilePath, ".json")
            };
        }

        return {
            protoBuffFilePath: `${resolvedFilePath}.pb`,
            legacyJsonFilePath: `${resolvedFilePath}.json`
        };
}

export function replaceExtension(ctx: TokenStoreContext, filePath: string, extension: string): string {
        const parsed = path.parse(filePath);

        return path.join(parsed.dir, `${parsed.name}${extension}`);
}

export async function fileExists(ctx: TokenStoreContext, filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);

            return true;
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code;

            if (code === "ENOENT" || code === "ENOTDIR") {
                return false;
            }

            throw err;
        }
}
