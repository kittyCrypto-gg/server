import rateLimiter from "../rateLimiter";
import type { RequestHandler } from "express";

const create: (options?: { filePath?: string }) => rateLimiter = options => new rateLimiter(options);
const one: Promise<{allowed: boolean; retryAfterSeconds: number; remainingAttempts: number }> = create().consume({
    scope: "scope", bucketKey: "bucket", windowMs: 1_000, maxAttempts: 1
});
const wrap: RequestHandler = create().wrap({
    scope: "scope", windowMs: 1_000, maxAttempts: 1
}, (_req, _res, _next) => undefined);
void one;
void wrap;
