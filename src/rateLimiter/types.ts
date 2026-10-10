import type { Request, Response } from "express";

export type NodeErrorWithCode = Error & { code?: string };

export interface StoredRateLimitBucket {
    resetAt: number;
    count: number;
}

export interface limState {
    buckets: Record<string, StoredRateLimitBucket>;
}

export interface rlArgs {
    scope: string;
    bucketKey: string;
    windowMs: number;
    maxAttempts: number;
    now?: number;
}

export interface rlDes {
    allowed: boolean;
    retryAfterSeconds: number;
    remainingAttempts: number;
}

export interface handlerOpts {
    scope: string;
    windowMs: number;
    maxAttempts: number;
    resolveBucketKey?: (req: Request) => string;
    resolveOriginKey?: (req: Request) => string;
    onRejected?: (req: Request, res: Response, decision: rlDes) => void;
}

export interface limiterOpts {
    filePath?: string;
}

export type RateLimiterStorePaths = {
    protoBuffFilePath: string;
    legacyJsonFilePath: string;
};
