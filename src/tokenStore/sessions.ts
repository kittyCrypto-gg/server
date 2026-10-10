import type { TokenStoreContext } from "./context";

/** Operate on the caller's live token Set and metadata map without copying either. */
export touchSessionToken(ctx: TokenStoreContext, token: string): void {
        ctx.tokenMeta.set(token, { expiresAtMs: Date.now() + ctx.ttlMs });
        ctx.sessionTokens.add(token);
        ctx.scheduleSaveTokenStore();
        ctx.onTokensChanged(ctx.sessionTokens);
    
}

export dropSessionToken(ctx: TokenStoreContext, token: string): void {
        ctx.tokenMeta.delete(token);
        ctx.sessionTokens.delete(token);
        ctx.scheduleSaveTokenStore();
        ctx.onTokensChanged(ctx.sessionTokens);
    
}

export isSessionTokenValid(ctx: TokenStoreContext, token: string): boolean {
        const meta = ctx.tokenMeta.get(token);

        if (!meta) return false;
        if (meta.expiresAtMs <= Date.now()) return false;

        return true;
    
}

export sessionTokenExpiryMs(ctx: TokenStoreContext, token: string): number | null {
        const meta = ctx.tokenMeta.get(token);

        return meta ? meta.expiresAtMs : null;
    
}
