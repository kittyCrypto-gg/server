import type { TokenStoreContext } from "./context";

/** Retain exactly the original readiness, initialisation and disposal lifecycle. */
export function initialiseTokenStore(ctx: TokenStoreContext): void {
    if (ctx.initPromise) return;

    ctx.initPromise = (async (): Promise<void> => {
        await ctx.loadTokenStore();
        ctx.onTokensChanged(ctx.sessionTokens);
        ctx.startCleanup();
        ctx.initialised = true;
    })().catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        ctx.initError = e;
        console.error("❌ Failed to initialise token store:", e);
        throw e;
    });
}

export async function waitUntilTokenStoreReady(ctx: TokenStoreContext): Promise<void> {
    if (ctx.initialised) return;

    if (!ctx.initPromise) {
        const e = new Error("tokenStore.init() was not called.");
        ctx.initError = e;
        throw e;
    }

    if (ctx.initError) throw ctx.initError;

    await ctx.initPromise;
}

export async function tokenExistsAndValidAsync(ctx: TokenStoreContext, token: string): Promise<boolean> {
    await ctx.waitUntilReady();

    return ctx.tokenExistsAndValid(token);
}

export function disposeTokenStore(ctx: TokenStoreContext): void {
    if (ctx.savePending) clearTimeout(ctx.savePending);
    if (ctx.cleanupTimer) clearInterval(ctx.cleanupTimer);

    ctx.savePending = null;
    ctx.cleanupTimer = null;
}
