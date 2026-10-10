import path from "path";
import type { TokenStorePaths } from "./types";
import type { TokenStoreContext } from "./context";
import { protoAndJsonPaths, replaceStoreExtension, storeFileExists } from "../storagePaths";

export function resolveStorePaths(ctx: TokenStoreContext, filePath: string | undefined): TokenStorePaths {
    const resolvedFilePath = filePath?.trim() || path.resolve(process.cwd(), "data", "sessionTokens.pb");
    return protoAndJsonPaths(resolvedFilePath, (file, ext) => ctx.replaceExtension(file, ext));
}

export function replaceExtension(ctx: TokenStoreContext, filePath: string, extension: string): string {
    return replaceStoreExtension(filePath, extension);
}

export async function fileExists(ctx: TokenStoreContext, filePath: string): Promise<boolean> {
    return await storeFileExists(filePath, true);
}
