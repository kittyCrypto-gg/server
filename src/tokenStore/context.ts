import type Server from "../baseServer";
import type { MutexProtoBuffStore } from "../mutexPBstore";
import type { TokenMeta, TokenStorePb, TokenStorePaths, TokenStoreJson, SessionTokenSink } from "./types";

/** Typed internal view; the original class retains all its private state and public interface. */
export interface TokenStoreContext {
    server: Server;
    sessionTokens: Set<string>;
    onTokensChanged: SessionTokenSink;
    filePath: string;
    legacyJsonFilePath: string;
    ttlMs: number;
    saveDebounceMs: number;
    cleanupIntervalMs: number;
    store: MutexProtoBuffStore<TokenStorePb>;
    savePending: NodeJS.Timeout | null;
    cleanupTimer: NodeJS.Timeout | null;
    migrationPromise: Promise<void> | null;
    tokenMeta: Map<string, TokenMeta>;
    initialised: boolean;
    initPromise: Promise<void> | null;
    initError: Error | null;
    init(): void;
    waitUntilReady(): Promise<void>;
    parseTimeString(value: string): number | null;
    tokenExistsAndValidAsync(token: string): Promise<boolean>;
    dispose(): void;
    touchToken(token: string): void;
    dropToken(token: string): void;
    tokenExistsAndValid(token: string): boolean;
    getExpiryMs(token: string): number | null;
    startCleanup(): void;
    loadTokenStore(): Promise<void>;
    saveTokenStore(): Promise<void>;
    scheduleSaveTokenStore(): void;
    ensureMigrated(): Promise<void>;
    migrateLegacyJsonIfNeeded(): Promise<void>;
    readLegacyJsonStore(): Promise<TokenStoreJson>;
    createStoredState(): TokenStorePb;
    normaliseLegacyJsonState(value: unknown): TokenStorePb;
    normaliseLegacyTokenMeta(value: unknown): TokenMeta | undefined;
    normaliseStoredState(value: unknown): TokenStorePb;
    normaliseStoredTokenMeta(value: unknown): TokenMeta | undefined;
    hasTokens(state: TokenStorePb): boolean;
    resolveStorePaths(filePath: string | undefined): TokenStorePaths;
    replaceExtension(filePath: string, extension: string): string;
    fileExists(filePath: string): Promise<boolean>;
    isRecord(value: unknown): value is Record<string, unknown>;
}
