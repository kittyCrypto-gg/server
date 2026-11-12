import { promises as fs } from "fs";
import type { TokenStoreJson } from "./types";
import type { TokenStoreContext } from "./context";

export async function ensureMigrated(ctx: TokenStoreContext): Promise<void> {
        ctx.migrationPromise ??= ctx.migrateLegacyJsonIfNeeded();

        await ctx.migrationPromise;
}

export async function migrateLegacyJsonIfNeeded(ctx: TokenStoreContext): Promise<void> {
        const protoBuffExists = await ctx.fileExists(ctx.filePath);

        if (protoBuffExists) {
            return;
        }

        const legacyJsonExists = await ctx.fileExists(ctx.legacyJsonFilePath);

        if (!legacyJsonExists) {
            return;
        }

        const legacyState = ctx.normaliseLegacyJsonState(await ctx.readLegacyJsonStore());

        await ctx.store.update((currentState) => {
            const normalisedCurrentState = ctx.normaliseStoredState(currentState);

            return ctx.hasTokens(normalisedCurrentState)
                ? normalisedCurrentState
                : legacyState;
        });
}

export async function readLegacyJsonStore(ctx: TokenStoreContext): Promise<TokenStoreJson> {
        const raw = await fs.readFile(ctx.legacyJsonFilePath, "utf-8");

        return JSON.parse(raw) as TokenStoreJson;
}
