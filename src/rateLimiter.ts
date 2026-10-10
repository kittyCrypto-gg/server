
import { Request, Response, NextFunction, RequestHandler } from "express";
import { MutexJsonStore } from "./mutexStore";
import { MutexProtoBuffStore } from "./mutexPBstore";
import { rateLimiterProtoCodec } from "./rateLimiter/codec";
import type { limState, rlArgs, rlDes, handlerOpts, limiterOpts, RateLimiterStorePaths, StoredRateLimitBucket } from "./rateLimiter/types";
import { resolveRequestBucketKey, createOriginBucketKey, pruneBuckets, createBucketId, validateArgs, getClientIp } from "./rateLimiter/logic";
import { normaliseState, normaliseBucket, normalisePositiveInteger, hasBuckets, isRecord } from "./rateLimiter/state";
import { resolveStorePaths, replaceExtension, fileExists } from "./rateLimiter/paths";

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
                }
                if (!decision.allowed && options.onRejected) {
                    options.onRejected(req, res, decision);
                    return;
                }
                if (!decision.allowed) {
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
        return resolveRequestBucketKey(options, req);
    }

    private createOriginBucketKey(originKey: string, bucketKey: string): string {
        return createOriginBucketKey(originKey, bucketKey);
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
        return pruneBuckets(state, now);
    }

    private createBucketId(scope: string, bucketKey: string, windowMs: number, maxAttempts: number): string {
        return createBucketId(scope, bucketKey, windowMs, maxAttempts);
    }

    private validateArgs(args: rlArgs): void {
        return validateArgs(args);
    }

    private getClientIp(req: Request): string {
        return getClientIp(req);
    }

    private normaliseState(value: unknown): limState {
        return normaliseState(value);
    }

    private normaliseBucket(value: unknown): StoredRateLimitBucket | undefined {
        return normaliseBucket(value);
    }

    private normalisePositiveInteger(value: unknown): number | undefined {
        return normalisePositiveInteger(value);
    }

    private hasBuckets(state: limState): boolean {
        return hasBuckets(state);
    }

    private resolveStorePaths(filePath: string | undefined): RateLimiterStorePaths {
        return resolveStorePaths(filePath);
    }

    private replaceExtension(filePath: string, extension: string): string {
        return replaceExtension(filePath, extension);
    }

    private async fileExists(filePath: string): Promise<boolean> {
        return await fileExists(filePath);
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return isRecord(value);
    }
}

export default rateLimiter;
