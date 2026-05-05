import { promises as fs } from "fs";
import { Request, Response, NextFunction, RequestHandler } from "express";
import * as protobuf from "protobufjs";
import type { IConversionOptions } from "protobufjs";
import path from "path";
import { MutexJsonStore } from "./mutexStore";
import { MutexProtoBuffStore, ProtoBuffCodec } from "./mutexPBstore";

type NodeErrorWithCode = Error & { code?: string };

interface StoredRateLimitBucket {
    resetAt: number;
    count: number;
}

interface limState {
    buckets: Record<string, StoredRateLimitBucket>;
}

interface rlArgs {
    scope: string;
    bucketKey: string;
    windowMs: number;
    maxAttempts: number;
    now?: number;
}

interface rlDes {
    allowed: boolean;
    retryAfterSeconds: number;
    remainingAttempts: number;
}

interface handlerOpts {
    scope: string;
    windowMs: number;
    maxAttempts: number;
    resolveBucketKey?: (req: Request) => string;
    resolveOriginKey?: (req: Request) => string;
    onRejected?: (req: Request, res: Response, decision: rlDes) => void;
}

interface limiterOpts {
    filePath?: string;
}

type RateLimiterStorePaths = {
    protoBuffFilePath: string;
    legacyJsonFilePath: string;
};

const rateLimiterProtoSchema = `
syntax = "proto3";

message StoredRateLimitBucket {
    int64 resetAt = 1;
    uint32 count = 2;
}

message LimState {
    map<string, StoredRateLimitBucket> buckets = 1;
}
`;

const rateLimiterProtoRoot = protobuf.parse(rateLimiterProtoSchema).root;
const rateLimiterMessageType = rateLimiterProtoRoot.lookupType("LimState");

const rateLimiterProtoConversionOptions: IConversionOptions = {
    longs: Number,
    enums: String,
    defaults: true,
    arrays: true,
    objects: true
};

const rateLimiterProtoCodec: ProtoBuffCodec<limState> = {
    encode: (value: limState): Buffer => {
        const validationError = rateLimiterMessageType.verify(value);

        if (validationError !== null) {
            throw new Error(`Rate limiter cannot encode invalid protobuf payload: ${validationError}`);
        }

        const message = rateLimiterMessageType.fromObject(value);
        const encoded = rateLimiterMessageType.encode(message).finish();

        return Buffer.from(encoded);
    },

    decode: (raw: Buffer): limState => {
        const message = rateLimiterMessageType.decode(raw);
        const plainObject = rateLimiterMessageType.toObject(message, rateLimiterProtoConversionOptions);

        return plainObject as limState;
    }
};

class rateLimiter {
    private readonly protoBuffFilePath: string;
    private readonly legacyJsonFilePath: string;
    private readonly store: MutexProtoBuffStore<limState>;
    private migrationPromise?: Promise<void>;

    public constructor(options: limiterOpts = {}) {
        const storePaths = this.resolveStorePaths(options.filePath);

        this.protoBuffFilePath = storePaths.protoBuffFilePath;
        this.legacyJsonFilePath = storePaths.legacyJsonFilePath;

        this.store = new MutexProtoBuffStore<limState>({
            filePath: this.protoBuffFilePath,
            initialValue: () => ({ buckets: {} }),
            codec: rateLimiterProtoCodec
        });
    }

    public async consume(args: rlArgs): Promise<rlDes> {
        await this.ensureMigrated();
        this.validateArgs(args);

        const now = args.now ?? Date.now();
        const bucketId = this.createBucketId(args.scope, args.bucketKey, args.windowMs, args.maxAttempts);

        let decision: rlDes | null = null;

        await this.store.update(async (currentState) => {
            const nextState = this.pruneBuckets(this.normaliseState(currentState), now);
            const existingBucket = nextState.buckets[bucketId];

            if (!existingBucket) {
                nextState.buckets[bucketId] = {
                    resetAt: now + args.windowMs,
                    count: 1
                };

                decision = {
                    allowed: true,
                    retryAfterSeconds: 0,
                    remainingAttempts: Math.max(0, args.maxAttempts - 1)
                };

                return nextState;
            }

            if (existingBucket.resetAt <= now) {
                nextState.buckets[bucketId] = {
                    resetAt: now + args.windowMs,
                    count: 1
                };

                decision = {
                    allowed: true,
                    retryAfterSeconds: 0,
                    remainingAttempts: Math.max(0, args.maxAttempts - 1)
                };

                return nextState;
            }

            if (existingBucket.count >= args.maxAttempts) {
                decision = {
                    allowed: false,
                    retryAfterSeconds: Math.max(1, Math.ceil((existingBucket.resetAt - now) / 1000)),
                    remainingAttempts: 0
                };

                return nextState;
            }

            existingBucket.count += 1;

            decision = {
                allowed: true,
                retryAfterSeconds: 0,
                remainingAttempts: Math.max(0, args.maxAttempts - existingBucket.count)
            };

            return nextState;
        });

        if (decision === null) {
            throw new Error("Rate limiter failed to produce a decision.");
        }

        return decision;
    }

    public wrap(options: handlerOpts, handler: RequestHandler): RequestHandler {
        return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
            try {
                const bucketKey = this.resolveRequestBucketKey(options, req);

                const decision = await this.consume({
                    scope: options.scope,
                    bucketKey,
                    windowMs: options.windowMs,
                    maxAttempts: options.maxAttempts
                });

                if (!decision.allowed) {
                    res.setHeader("Retry-After", String(decision.retryAfterSeconds));

                    if (options.onRejected) {
                        options.onRejected(req, res, decision);
                        return;
                    }

                    res.status(429).json({
                        ok: false,
                        error: `Too many requests. Retry in ${String(decision.retryAfterSeconds)} seconds.`
                    });
                    return;
                }

                await Promise.resolve(handler(req, res, next));
            } catch (error) {
                next(error);
            }
        };
    }

    private resolveRequestBucketKey(options: handlerOpts, req: Request): string {
        const baseBucketKey = options.resolveBucketKey
            ? options.resolveBucketKey(req).trim()
            : this.getClientIp(req);

        const originKey = options.resolveOriginKey?.(req).trim() ?? "";

        if (!originKey) {
            return baseBucketKey;
        }

        return this.createOriginBucketKey(originKey, baseBucketKey);
    }

    private createOriginBucketKey(originKey: string, bucketKey: string): string {
        return `${encodeURIComponent(originKey)}:${encodeURIComponent(bucketKey)}`;
    }

    private async ensureMigrated(): Promise<void> {
        this.migrationPromise ??= this.migrateLegacyJsonIfNeeded();

        await this.migrationPromise;
    }

    private async migrateLegacyJsonIfNeeded(): Promise<void> {
        const protoBuffExists = await this.fileExists(this.protoBuffFilePath);

        if (protoBuffExists) {
            return;
        }

        const legacyJsonExists = await this.fileExists(this.legacyJsonFilePath);

        if (!legacyJsonExists) {
            return;
        }

        const legacyStore = new MutexJsonStore<limState>({
            filePath: this.legacyJsonFilePath,
            initialValue: () => ({ buckets: {} })
        });

        const legacyState = this.normaliseState(await legacyStore.read());

        await this.store.update((currentState) => {
            const normalisedCurrentState = this.normaliseState(currentState);

            return this.hasBuckets(normalisedCurrentState)
                ? normalisedCurrentState
                : legacyState;
        });
    }

    private pruneBuckets(state: limState, now: number): limState {
        const nextBuckets: Record<string, StoredRateLimitBucket> = {};

        for (const [bucketId, bucket] of Object.entries(state.buckets)) {
            if (bucket.resetAt > now) {
                nextBuckets[bucketId] = bucket;
            }
        }

        return {
            buckets: nextBuckets
        };
    }

    private createBucketId(scope: string, bucketKey: string, windowMs: number, maxAttempts: number): string {
        return `${scope}:${bucketKey}:${String(windowMs)}:${String(maxAttempts)}`;
    }

    private validateArgs(args: rlArgs): void {
        if (!args.scope.trim()) {
            throw new Error("Rate limit scope is required.");
        }

        if (!args.bucketKey.trim()) {
            throw new Error("Rate limit bucketKey is required.");
        }

        if (!Number.isInteger(args.windowMs) || args.windowMs <= 0) {
            throw new Error("Rate limit windowMs must be a positive integer.");
        }

        if (!Number.isInteger(args.maxAttempts) || args.maxAttempts <= 0) {
            throw new Error("Rate limit maxAttempts must be a positive integer.");
        }
    }

    private getClientIp(req: Request): string {
        const cf = req.headers["cf-connecting-ip"];

        if (typeof cf === "string" && cf.trim()) return cf.trim();

        const xff = req.headers["x-forwarded-for"];
        const raw = Array.isArray(xff) ? xff[0] : xff;

        let ip = typeof raw === "string" && raw.trim()
            ? raw.split(",")[0]!.trim()
            : (req.socket.remoteAddress || "");

        if (ip.startsWith("::ffff:")) ip = ip.substring(7);

        return ip;
    }

    private normaliseState(value: unknown): limState {
        if (!this.isRecord(value)) {
            return {
                buckets: {}
            };
        }

        const rawBuckets = this.isRecord(value.buckets) ? value.buckets : {};
        const buckets: Record<string, StoredRateLimitBucket> = {};

        for (const [bucketId, rawBucket] of Object.entries(rawBuckets)) {
            const bucket = this.normaliseBucket(rawBucket);

            if (!bucket) {
                continue;
            }

            buckets[bucketId] = bucket;
        }

        return {
            buckets
        };
    }

    private normaliseBucket(value: unknown): StoredRateLimitBucket | undefined {
        if (!this.isRecord(value)) {
            return undefined;
        }

        const resetAt = this.normalisePositiveInteger(value.resetAt);
        const count = this.normalisePositiveInteger(value.count);

        if (typeof resetAt !== "number" || typeof count !== "number") {
            return undefined;
        }

        return {
            resetAt,
            count
        };
    }

    private normalisePositiveInteger(value: unknown): number | undefined {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            return undefined;
        }

        return Math.floor(value);
    }

    private hasBuckets(state: limState): boolean {
        return Object.keys(state.buckets).length > 0;
    }

    private resolveStorePaths(filePath: string | undefined): RateLimiterStorePaths {
        const resolvedFilePath = filePath?.trim() || path.resolve(process.cwd(), "data", "rateLimits.pb");
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

            if (code === "ENOENT") {
                return false;
            }

            throw err;
        }
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
}

export default rateLimiter;