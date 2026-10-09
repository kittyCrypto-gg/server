import type { TokenMeta, TokenStoreJson, TokenStorePb } from "./types";
import type { TokenStoreContext } from "./context";

export function parseTimeString(ctx: TokenStoreContext, value: string): number | null {
        const match = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(value);

        if (!match) return null;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hour = Number(match[4]);
        const minute = Number(match[5]);
        const second = Number(match[6]);
        const millisecond = Number(match[7]);

        return new Date(year, month - 1, day, hour, minute, second, millisecond).getTime();
}

export function createStoredState(ctx: TokenStoreContext): TokenStorePb {
        return {
            version: 1,
            tokens: Object.fromEntries(
                Array.from(ctx.tokenMeta.entries()).map(([token, meta]) => [
                    token,
                    { expiresAtMs: meta.expiresAtMs }
                ])
            )
        };
}

export function normaliseLegacyJsonState(ctx: TokenStoreContext, value: unknown): TokenStorePb {
        if (!ctx.isRecord(value)) {
            return {
                version: 1,
                tokens: {}
            };
        }

        const rawTokens = ctx.isRecord(value.tokens) ? value.tokens : {};
        const tokens: Record<string, TokenMeta> = {};
        const now = Date.now();

        for (const [token, rawMeta] of Object.entries(rawTokens)) {
            const meta = ctx.normaliseLegacyTokenMeta(rawMeta);

            if (!meta || meta.expiresAtMs <= now) {
                continue;
            }

            tokens[token] = meta;
        }

        return {
            version: 1,
            tokens
        };
}

export function normaliseLegacyTokenMeta(ctx: TokenStoreContext, value: unknown): TokenMeta | undefined {
        if (!ctx.isRecord(value)) {
            return undefined;
        }

        const rawExpiresAt = value.expiresAt;

        if (typeof rawExpiresAt !== "string") {
            return undefined;
        }

        const expiresAtMs = ctx.parseTimeString(rawExpiresAt);

        if (expiresAtMs === null) {
            return undefined;
        }

        return {
            expiresAtMs
        };
}

export function normaliseStoredState(ctx: TokenStoreContext, value: unknown): TokenStorePb {
        if (!ctx.isRecord(value)) {
            return {
                version: 1,
                tokens: {}
            };
        }

        const rawTokens = ctx.isRecord(value.tokens) ? value.tokens : {};
        const tokens: Record<string, TokenMeta> = {};

        for (const [token, rawMeta] of Object.entries(rawTokens)) {
            const meta = ctx.normaliseStoredTokenMeta(rawMeta);

            if (!meta) {
                continue;
            }

            tokens[token] = meta;
        }

        return {
            version: 1,
            tokens
        };
}

export function normaliseStoredTokenMeta(ctx: TokenStoreContext, value: unknown): TokenMeta | undefined {
        if (!ctx.isRecord(value)) {
            return undefined;
        }

        const rawExpiresAtMs = value.expiresAtMs;

        if (typeof rawExpiresAtMs !== "number" || !Number.isFinite(rawExpiresAtMs) || rawExpiresAtMs <= 0) {
            return undefined;
        }

        return {
            expiresAtMs: Math.floor(rawExpiresAtMs)
        };
}

export function hasTokens(ctx: TokenStoreContext, state: TokenStorePb): boolean {
        return Object.keys(state.tokens).length > 0;
}

export function isRecord(ctx: TokenStoreContext, value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
}
