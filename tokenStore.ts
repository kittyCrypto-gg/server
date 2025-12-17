import fs from "fs";
import path from "path";
import Server from "./baseServer";

export type TokenMeta = {
    expiresAtMs: number;
};

export type TokenStoreJson = {
    version: 1;
    tokens: Record<string, { expiresAt: string }>;
};

export type SessionTokenStoreOpts = {
    filePath?: string;
    ttlMs?: number;
    saveDebounceMs?: number;
    cleanupIntervalMs?: number;
};

export type SessionTokenSink = (tokens: Set<string>) => void;

export class tokenStore {
    private readonly server: Server;
    private readonly sessionTokens: Set<string>;
    private readonly onTokensChanged: SessionTokenSink;

    private readonly filePath: string;
    private readonly ttlMs: number;
    private readonly saveDebounceMs: number;
    private readonly cleanupIntervalMs: number;

    private savePending: NodeJS.Timeout | null = null;
    private cleanupTimer: NodeJS.Timeout | null = null;

    private readonly tokenMeta = new Map<string, TokenMeta>();

    private initialised: boolean = false;
    private initPromise: Promise<void> | null = null;
    private initError: Error | null = null;

    public constructor(
        server: Server,
        sessionTokens: Set<string>,
        onTokensChanged: (tokens: Set<string>) => void,
        opts: SessionTokenStoreOpts = {}
    ) {
        this.server = server;
        this.sessionTokens = sessionTokens;
        this.onTokensChanged = onTokensChanged;

        this.filePath = opts.filePath ?? path.join(__dirname, "sessionTokens.json");
        this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
        this.saveDebounceMs = opts.saveDebounceMs ?? 250;
        this.cleanupIntervalMs = opts.cleanupIntervalMs ?? 60_000;
    }

    public init(): void {
        if (this.initPromise) return;

        this.initPromise = (async (): Promise<void> => {
            await this.loadTokenStore();
            this.onTokensChanged(this.sessionTokens);
            this.startCleanup();
            this.initialised = true;
        })().catch((err: unknown) => {
            const e = err instanceof Error ? err : new Error(String(err));
            this.initError = e;
            console.error("❌ Failed to initialise token store:", e);
            throw e;
        });
    }

    public async waitUntilReady(): Promise<void> {
        if (this.initialised) return;

        if (!this.initPromise) {
            const e = new Error("tokenStore.init() was not called.");
            this.initError = e;
            throw e;
        }

        if (this.initError) throw this.initError;

        await this.initPromise;
    }

    private formatMs(ms: number): string {
        const d = new Date(ms);
        const pad = (n: number, w = 2) => String(n).padStart(w, "0");

        return (
            `${d.getFullYear()}.` +
            `${pad(d.getMonth() + 1)}.` +
            `${pad(d.getDate())} ` +
            `${pad(d.getHours())}:` +
            `${pad(d.getMinutes())}:` +
            `${pad(d.getSeconds())}.` +
            `${pad(d.getMilliseconds(), 3)}`
        );
    }

    private parseTimeString(s: string): number | null {
        const m = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(s);
        if (!m) return null;

        const [, Y, M, D, h, m2, s2, ms] = m.map(Number) as unknown as number[];
        return new Date(Y, M - 1, D, h, m2, s2, ms).getTime();
    }

    public async tokenExistsAndValidAsync(token: string): Promise<boolean> {
        await this.waitUntilReady();
        return this.tokenExistsAndValid(token);
    }

    public dispose(): void {
        if (this.savePending) clearTimeout(this.savePending);
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        this.savePending = null;
        this.cleanupTimer = null;
    }

    public touchToken(token: string): void {
        this.tokenMeta.set(token, { expiresAtMs: Date.now() + this.ttlMs });
        this.sessionTokens.add(token);
        this.scheduleSaveTokenStore();
        this.onTokensChanged(this.sessionTokens);
    }

    public dropToken(token: string): void {
        this.tokenMeta.delete(token);
        this.sessionTokens.delete(token);
        this.scheduleSaveTokenStore();
        this.onTokensChanged(this.sessionTokens);
    }

    public tokenExistsAndValid(token: string): boolean {
        const meta = this.tokenMeta.get(token);
        if (!meta) return false;
        if (meta.expiresAtMs <= Date.now()) return false;
        return true;
    }

    public getExpiryMs(token: string): number | null {
        const meta = this.tokenMeta.get(token);
        return meta ? meta.expiresAtMs : null;
    }

    private startCleanup(): void {
        if (this.cleanupTimer) return;

        this.cleanupTimer = setInterval(() => {
            const at = Date.now();
            for (const [token, meta] of this.tokenMeta.entries()) {
                if (meta.expiresAtMs <= at) {
                    this.tokenMeta.delete(token);
                    this.sessionTokens.delete(token);
                }
            }

            this.scheduleSaveTokenStore();
            this.onTokensChanged(this.sessionTokens);
        }, this.cleanupIntervalMs);
    }

    private async loadTokenStore(): Promise<void> {
        const exists = await fs.promises.stat(this.filePath).then(() => true).catch(() => false);

        if (!exists) {
            const initial: TokenStoreJson = { version: 1, tokens: {} };
            await fs.promises.writeFile(
                this.filePath,
                JSON.stringify(initial, null, 2),
                "utf-8"
            );
            return;
        }

        const raw = await fs.promises.readFile(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as TokenStoreJson;

        const now = Date.now();
        const entries = Object.entries(parsed.tokens ?? {});
        for (const [token, meta] of entries) {
            if (!meta) continue;
            if (typeof meta.expiresAt !== "string") continue;

            const expiresAtMs = this.parseTimeString(meta.expiresAt);
            if (expiresAtMs === null) continue;
            if (expiresAtMs <= now) continue;

            this.tokenMeta.set(token, { expiresAtMs });
            this.sessionTokens.add(token);
        }
    }

    private async saveTokenStore(): Promise<void> {
        const now = Date.now();

        for (const [token, meta] of this.tokenMeta.entries()) {
            if (!this.sessionTokens.has(token) || meta.expiresAtMs <= now) {
                this.tokenMeta.delete(token);
                this.sessionTokens.delete(token);
            }
        }

        const json: TokenStoreJson = {
            version: 1,
            tokens: Object.fromEntries(
                Array.from(this.tokenMeta.entries()).map(([token, meta]) => [
                    token,
                    { expiresAt: this.formatMs(meta.expiresAtMs) }
                ])
            )
        };

        const tmp = `${this.filePath}.tmp`;
        await fs.promises.writeFile(
            tmp,
            JSON.stringify(json, null, 2),
            "utf-8"
        );

        await fs.promises.rename(tmp, this.filePath);
    }

    private scheduleSaveTokenStore(): void {
        if (this.savePending) return;

        this.savePending = setTimeout(async () => {
            this.savePending = null;
            try {
                await this.saveTokenStore();
            } catch (err) {
                console.error("❌ Failed to save token store:", err);
            }
        }, this.saveDebounceMs);
    }
}