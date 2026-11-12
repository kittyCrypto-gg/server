import type { TokenStoreContext } from "./context";

export function startCleanup(ctx: TokenStoreContext): void {
        if (ctx.cleanupTimer) return;

        ctx.cleanupTimer = setInterval(() => {
            const at = Date.now();

            for (const [token, meta] of ctx.tokenMeta.entries()) {
                if (meta.expiresAtMs <= at) {
                    ctx.tokenMeta.delete(token);
                    ctx.sessionTokens.delete(token);
                }
            }

            ctx.scheduleSaveTokenStore();
            ctx.onTokensChanged(ctx.sessionTokens);
        }, ctx.cleanupIntervalMs);
}
