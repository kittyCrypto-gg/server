import { Request, Response, NextFunction, RequestHandler } from "express";
import { MutexJsonStore } from "./mutexJsonStore";
import path from "path";

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
    onRejected?: (req: Request, res: Response, decision: rlDes) => void;
}

interface limiterOpts {
    filePath?: string;
}

class rateLimiter {
    private readonly store: MutexJsonStore<limState>;

    public constructor(options: limiterOpts = {}) {
        const filePath = options.filePath?.trim() || path.resolve(process.cwd(), "data", "rateLimits.json");

        this.store = new MutexJsonStore<limState>({
            filePath,
            initialValue: () => ({ buckets: {} })
        });
    }

    public async consume(args: rlArgs): Promise<rlDes> {
        this.validateArgs(args);

        const now = args.now ?? Date.now();
        const bucketId = this.createBucketId(args.scope, args.bucketKey, args.windowMs, args.maxAttempts);

        let decision: rlDes | null = null;

        await this.store.update(async (currentState) => {
            const nextState = this.pruneBuckets(currentState, now);
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
                const bucketKey = options.resolveBucketKey
                    ? options.resolveBucketKey(req).trim()
                    : this.getClientIp(req);

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
}

export default rateLimiter;