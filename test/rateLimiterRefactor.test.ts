import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import RateLimiter from "../src/rateLimiter";

test("limiter decisions, attempt count, expiry and scope isolation remain stable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "limiter-refactor-"));
    try {
        const limiter = new RateLimiter({ filePath: path.join(dir, "counter.pb") });
        const common = { scope: "login", bucketKey: "person", windowMs: 1_000, maxAttempts: 2 };
        expect(await limiter.consume({ ...common, now: 100 })).toEqual({
            allowed: true, retryAfterSeconds: 0, remainingAttempts: 1
        });
        expect(await limiter.consume({ ...common, now: 200 })).toEqual({
            allowed: true, retryAfterSeconds: 0, remainingAttempts: 0
        });
        expect(await limiter.consume({ ...common, now: 300 })).toEqual({
            allowed: false, retryAfterSeconds: 1, remainingAttempts: 0
        });
        expect(await limiter.consume({ ...common, scope: "other", now: 400 })).toEqual({
            allowed: true, retryAfterSeconds: 0, remainingAttempts: 1
        });
        expect(await limiter.consume({ ...common, now: 1_100 })).toEqual({
            allowed: true, retryAfterSeconds: 0, remainingAttempts: 1
        });
        const reloaded = new RateLimiter({ filePath: path.join(dir, "counter.pb") });
        expect((await reloaded.consume({ ...common, now: 1_200 })).remainingAttempts).toBe(0);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("legacy JSON rate-limit buckets migrate to protobuf with preserved counters", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "limiter-migration-"));
    try {
        const filePath = path.join(dir, "limiter.json");
        const old = { buckets: { "test:client:1000:3": { resetAt: 20_000, count: 2 } } };
        await writeFile(filePath, JSON.stringify(old));
        const limiter = new RateLimiter({ filePath });
        expect(await limiter.consume({
            scope: "test", bucketKey: "client", windowMs: 1_000, maxAttempts: 3, now: 10_000
        })).toEqual({ allowed: true, retryAfterSeconds: 0, remainingAttempts: 0 });
        expect(await readFile(path.join(dir, "limiter.pb"))).toHaveLength(expect.any(Number));
        expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(old);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("middleware preserves 429, Retry-After, forwarding and client IP selection", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "limiter-middleware-"));
    try {
        const limiter = new RateLimiter({ filePath: path.join(dir, "middleware.pb") });
        const middleware = limiter.wrap({ scope: "login", windowMs: 60_000, maxAttempts: 1 },
            (_req, _res, _next) => { accepted++; });
        let accepted = 0;
        const req = { headers: { "cf-connecting-ip": "203.0.113.5" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as Request;
        let httpStatus = 0;
        let body: unknown;
        const headers: Record<string, string> = {};
        const res = {
            setHeader: (key: string, value: string) => { headers[key] = value; },
            status: (value: number) => { httpStatus = value; return res; },
            json: (value: unknown) => { body = value; return res; }
        } as unknown as Response;
        const errors: unknown[] = [];
        const next = (error?: unknown) => { if (error !== undefined) errors.push(error); } ;
        await middleware(req, res, next as NextFunction);
        await middleware(req, res, next as NextFunction);
        expect(accepted).toBe(1);
        expect(httpStatus).toBe(429);
        expect(headers["Retry-After"]).toBeDefined();
        expect(body).toMatchObject({ ok: false });
        expect(errors).toEqual([]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
