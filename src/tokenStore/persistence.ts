import type { TokenStoreContext } from "./context";

export async function loadTokenStore(ctx: TokenStoreContext): Promise<void> {
        await ctx.ensureMigrated();

        const storedState = ctx.normaliseStoredState(await ctx.store.read());
        const now = Date.now();

        for (const [token, meta] of Object.entries(storedState.tokens)) {
            if (meta.expiresAtMs <= now) {
                continue;
            }

            ctx.tokenMeta.set(token, { expiresAtMs: meta.expiresAtMs });
            ctx.sessionTokens.add(token);
        }
}

export async function saveTokenStore(ctx: TokenStoreContext): Promise<void> {
        const now = Date.now();

        for (const [token, meta] of ctx.tokenMeta.entries()) {
            if (!ctx.sessionTokens.has(token) || meta.expiresAtMs <= now) {
                ctx.tokenMeta.delete(token);
                ctx.sessionTokens.delete(token);
            }
        }

        await ctx.store.update(() => ctx.createStoredState());
}

export function scheduleSaveTokenStore(ctx: TokenStoreContext): void {
        if (ctx.savePending) return;

        ctx.savePending = setTimeout(async () => {
            ctx.savePending = null;

            try {
                await ctx.saveTokenStore();
            } catch (err) {
                console.error("❌ Failed to save token store:", err);
            }
        }, ctx.saveDebounceMs);
}
