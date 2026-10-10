import path from "node:path";
import type { TokenStorePaths } from "./types";
import type { TokenStoreContext } from "./context";
import { resolveProtoJsonStorePaths, replaceFileExtension, storeFileExists } from "../storePaths";

export function resolveStorePaths(ctx: TokenStoreContext, filePath: string | undefined): TokenStorePaths {
    return resolveProtoJsonStorePaths(filePath, {
        defaultFilePath: path.resolve(process.cwd(), "data", "sessionTokens.pb"),
        trimProvidedPath: true,
        replaceExtension: (candidate, ext) => ctx.replaceExtension(candidate, ext)
    });
}

export function replaceExtension(ctx: TokenStoreContext, filePath: string, extension: string): string {
    return replaceFileExtension(filePath, extension);
}

export async function fileExists(ctx: TokenStoreContext, filePath: string): Promise<boolean> {
    return storeFileExists(filePath, ["ENOENT", "ENOTDIR"]);
}
