import type { Request } from "express";
import type { handlerOpts, rlArgs, limState, StoredRateLimitBucket } from "./types";


export function resolveRequestBucketKey(options: handlerOpts, req: Request): string {
    const baseBucketKey = options.resolveBucketKey
        ? options.resolveBucketKey(req).trim()
        : getClientIp(req);

    const originKey = options.resolveOriginKey?.(req).trim() ?? "";

    if (!originKey) {
        return baseBucketKey;
    }

    return createOriginBucketKey(originKey, baseBucketKey);
}

export function createOriginBucketKey(originKey: string, bucketKey: string): string {
    return `${encodeURIComponent(originKey)}:${encodeURIComponent(bucketKey)}`;
}

export function pruneBuckets(state: limState, now: number): limState {
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

export function createBucketId(scope: string, bucketKey: string, windowMs: number, maxAttempts: number): string {
    return `${scope}:${bucketKey}:${String(windowMs)}:${String(maxAttempts)}`;
}

export function validateArgs(args: rlArgs): void {
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

export function getClientIp(req: Request): string {
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
