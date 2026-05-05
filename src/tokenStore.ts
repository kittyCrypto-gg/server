import { promises as fs } from "fs";
import path from "path";
import * as protobuf from "protobufjs";
import type { IConversionOptions } from "protobufjs";
import Server from "./baseServer";
import { MutexProtoBuffStore, ProtoBuffCodec } from "./mutexPBstore";

type NodeErrorWithCode = Error & { code?: string };

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

type TokenStorePb = {
    version: 1;
    tokens: Record<string, TokenMeta>;
};

type TokenStorePaths = {
    protoBuffFilePath: string;
    legacyJsonFilePath: string;
};

const sessionTokensProtoSchema = `
syntax = "proto3";

message TokenMeta {
    int64 expiresAtMs = 1;
}

message TokenStorePb {
    uint32 version = 1;
    map<string, TokenMeta> tokens = 2;
}
`;

const sessionTokensProtoRoot = protobuf.parse(sessionTokensProtoSchema).root;
const sessionTokensMessageType = sessionTokensProtoRoot.lookupType("TokenStorePb");

const sessionTokensProtoConversionOptions: IConversionOptions = {
    longs: Number,
    enums: String,
    defaults: true,
    arrays: true,
    objects: true
};

const sessionTokensProtoCodec: ProtoBuffCodec<TokenStorePb> = {
    encode: (value: TokenStorePb): Buffer => {
        const validationError = sessionTokensMessageType.verify(value);

        if (validationError !== null) {
            throw new Error(`Session token store cannot encode invalid protobuf payload: ${validationError}`);
        }

        const message = sessionTokensMessageType.fromObject(value);
        const encoded = sessionTokensMessageType.encode(message).finish();

        return Buffer.from(encoded);
    },

    decode: (raw: Buffer): TokenStorePb => {
        const message = sessionTokensMessageType.decode(raw);
        const plainObject = sessionTokensMessageType.toObject(message, sessionTokensProtoConversionOptions);

        return plainObject as TokenStorePb;
    }
};

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
        await this.ensureMigrated();

        const storedState = this.normaliseStoredState(await this.store.read());
        const now = Date.now();

        for (const [token, meta] of Object.entries(storedState.tokens)) {
            if (meta.expiresAtMs <= now) {
                continue;
            }

            this.tokenMeta.set(token, { expiresAtMs: meta.expiresAtMs });
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

        await this.store.update(() => this.createStoredState());
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

    private async ensureMigrated(): Promise<void> {
        this.migrationPromise ??= this.migrateLegacyJsonIfNeeded();

        await this.migrationPromise;
    }

    private async migrateLegacyJsonIfNeeded(): Promise<void> {
        const protoBuffExists = await this.fileExists(this.filePath);

        if (protoBuffExists) {
            return;
        }

        const legacyJsonExists = await this.fileExists(this.legacyJsonFilePath);

        if (!legacyJsonExists) {
            return;
        }

        const legacyState = this.normaliseLegacyJsonState(await this.readLegacyJsonStore());

        await this.store.update((currentState) => {
            const normalisedCurrentState = this.normaliseStoredState(currentState);

            return this.hasTokens(normalisedCurrentState)
                ? normalisedCurrentState
                : legacyState;
        });
    }

    private async readLegacyJsonStore(): Promise<TokenStoreJson> {
        const raw = await fs.readFile(this.legacyJsonFilePath, "utf-8");

        return JSON.parse(raw) as TokenStoreJson;
    }

    private createStoredState(): TokenStorePb {
        return {
            version: 1,
            tokens: Object.fromEntries(
                Array.from(this.tokenMeta.entries()).map(([token, meta]) => [
                    token,
                    { expiresAtMs: meta.expiresAtMs }
                ])
            )
        };
    }

    private normaliseLegacyJsonState(value: unknown): TokenStorePb {
        if (!this.isRecord(value)) {
            return {
                version: 1,
                tokens: {}
            };
        }

        const rawTokens = this.isRecord(value.tokens) ? value.tokens : {};
        const tokens: Record<string, TokenMeta> = {};
        const now = Date.now();

        for (const [token, rawMeta] of Object.entries(rawTokens)) {
            const meta = this.normaliseLegacyTokenMeta(rawMeta);

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

    private normaliseLegacyTokenMeta(value: unknown): TokenMeta | undefined {
        if (!this.isRecord(value)) {
            return undefined;
        }

        const rawExpiresAt = value.expiresAt;

        if (typeof rawExpiresAt !== "string") {
            return undefined;
        }

        const expiresAtMs = this.parseTimeString(rawExpiresAt);

        if (expiresAtMs === null) {
            return undefined;
        }

        return {
            expiresAtMs
        };
    }

    private normaliseStoredState(value: unknown): TokenStorePb {
        if (!this.isRecord(value)) {
            return {
                version: 1,
                tokens: {}
            };
        }

        const rawTokens = this.isRecord(value.tokens) ? value.tokens : {};
        const tokens: Record<string, TokenMeta> = {};

        for (const [token, rawMeta] of Object.entries(rawTokens)) {
            const meta = this.normaliseStoredTokenMeta(rawMeta);

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

    private normaliseStoredTokenMeta(value: unknown): TokenMeta | undefined {
        if (!this.isRecord(value)) {
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

    private hasTokens(state: TokenStorePb): boolean {
        return Object.keys(state.tokens).length > 0;
    }

    private resolveStorePaths(filePath: string | undefined): TokenStorePaths {
        const resolvedFilePath = filePath?.trim() || path.resolve(process.cwd(), "data", "sessionTokens.pb");
        const extension = path.extname(resolvedFilePath).toLowerCase();

        if (extension === ".json") {
            return {
                protoBuffFilePath: this.replaceExtension(resolvedFilePath, ".pb"),
                legacyJsonFilePath: resolvedFilePath
            };
        }

        if (extension === ".pb") {
            return {
                protoBuffFilePath: resolvedFilePath,
                legacyJsonFilePath: this.replaceExtension(resolvedFilePath, ".json")
            };
        }

        return {
            protoBuffFilePath: `${resolvedFilePath}.pb`,
            legacyJsonFilePath: `${resolvedFilePath}.json`
        };
    }

    private replaceExtension(filePath: string, extension: string): string {
        const parsed = path.parse(filePath);

        return path.join(parsed.dir, `${parsed.name}${extension}`);
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);

            return true;
        } catch (err: unknown) {
            const code = (err as NodeErrorWithCode).code;

            if (code === "ENOENT" || code === "ENOTDIR") {
                return false;
            }

            throw err;
        }
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
}