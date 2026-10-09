import Server from "./baseServer";
import { MutexProtoBuffStore } from "./mutexPBstore";
import type { TokenMeta, TokenStoreJson, SessionTokenStoreOpts, SessionTokenSink, TokenStorePb, TokenStorePaths } from "./tokenStore/types";
import { sessionTokensProtoCodec } from "./tokenStore/schema";
import type { TokenStoreContext } from "./tokenStore/context";
import { parseTimeString as parseTimeString_operation, createStoredState as createStoredState_operation, normaliseLegacyJsonState as normaliseLegacyJsonState_operation, normaliseLegacyTokenMeta as normaliseLegacyTokenMeta_operation, normaliseStoredState as normaliseStoredState_operation, normaliseStoredTokenMeta as normaliseStoredTokenMeta_operation, hasTokens as hasTokens_operation, isRecord as isRecord_operation } from "./tokenStore/normalisation";
import { resolveStorePaths as resolveStorePaths_operation, replaceExtension as replaceExtension_operation, fileExists as fileExists_operation } from "./tokenStore/paths";
import { ensureMigrated as ensureMigrated_operation, migrateLegacyJsonIfNeeded as migrateLegacyJsonIfNeeded_operation, readLegacyJsonStore as readLegacyJsonStore_operation } from "./tokenStore/migration";
import { loadTokenStore as loadTokenStore_operation, saveTokenStore as saveTokenStore_operation, scheduleSaveTokenStore as scheduleSaveTokenStore_operation } from "./tokenStore/persistence";
import { startCleanup as startCleanup_operation } from "./tokenStore/cleanup";

export type { TokenMeta, TokenStoreJson, SessionTokenStoreOpts, SessionTokenSink } from "./tokenStore/types";

export class tokenStore {
    private readonly server: Server;
    private readonly sessionTokens: Set<string>;
    private readonly onTokensChanged: SessionTokenSink;

    private readonly filePath: string;
    private readonly legacyJsonFilePath: string;
    private readonly ttlMs: number;
    private readonly saveDebounceMs: number;
    private readonly cleanupIntervalMs: number;
    private readonly store: MutexProtoBuffStore<TokenStorePb>;

    private savePending: NodeJS.Timeout | null = null;
    private cleanupTimer: NodeJS.Timeout | null = null;
    private migrationPromise: Promise<void> | null = null;

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
        const storePaths = this.resolveStorePaths(opts.filePath);

        this.server = server;
        this.sessionTokens = sessionTokens;
        this.onTokensChanged = onTokensChanged;

        this.filePath = storePaths.protoBuffFilePath;
        this.legacyJsonFilePath = storePaths.legacyJsonFilePath;
        this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
        this.saveDebounceMs = opts.saveDebounceMs ?? 250;
        this.cleanupIntervalMs = opts.cleanupIntervalMs ?? 60_000;

        this.store = new MutexProtoBuffStore<TokenStorePb>({
            filePath: this.filePath,
            initialValue: () => ({
                version: 1,
                tokens: {}
            }),
            codec: sessionTokensProtoCodec
        });
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

    private parseTimeString(value: string): number | null {
        return parseTimeString_operation(this as unknown as TokenStoreContext, value);
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
        return startCleanup_operation(this as unknown as TokenStoreContext);
    }

    private async loadTokenStore(): Promise<void> {
        return loadTokenStore_operation(this as unknown as TokenStoreContext);
    }

    private async saveTokenStore(): Promise<void> {
        return saveTokenStore_operation(this as unknown as TokenStoreContext);
    }

    private scheduleSaveTokenStore(): void {
        return scheduleSaveTokenStore_operation(this as unknown as TokenStoreContext);
    }

    private async ensureMigrated(): Promise<void> {
        return ensureMigrated_operation(this as unknown as TokenStoreContext);
    }

    private async migrateLegacyJsonIfNeeded(): Promise<void> {
        return migrateLegacyJsonIfNeeded_operation(this as unknown as TokenStoreContext);
    }

    private async readLegacyJsonStore(): Promise<TokenStoreJson> {
        return readLegacyJsonStore_operation(this as unknown as TokenStoreContext);
    }

    private createStoredState(): TokenStorePb {
        return createStoredState_operation(this as unknown as TokenStoreContext);
    }

    private normaliseLegacyJsonState(value: unknown): TokenStorePb {
        return normaliseLegacyJsonState_operation(this as unknown as TokenStoreContext, value);
    }

    private normaliseLegacyTokenMeta(value: unknown): TokenMeta | undefined {
        return normaliseLegacyTokenMeta_operation(this as unknown as TokenStoreContext, value);
    }

    private normaliseStoredState(value: unknown): TokenStorePb {
        return normaliseStoredState_operation(this as unknown as TokenStoreContext, value);
    }

    private normaliseStoredTokenMeta(value: unknown): TokenMeta | undefined {
        return normaliseStoredTokenMeta_operation(this as unknown as TokenStoreContext, value);
    }

    private hasTokens(state: TokenStorePb): boolean {
        return hasTokens_operation(this as unknown as TokenStoreContext, state);
    }

    private resolveStorePaths(filePath: string | undefined): TokenStorePaths {
        return resolveStorePaths_operation(this as unknown as TokenStoreContext, filePath);
    }

    private replaceExtension(filePath: string, extension: string): string {
        return replaceExtension_operation(this as unknown as TokenStoreContext, filePath, extension);
    }

    private async fileExists(filePath: string): Promise<boolean> {
        return fileExists_operation(this as unknown as TokenStoreContext, filePath);
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return isRecord_operation(this as unknown as TokenStoreContext, value);
    }
}
