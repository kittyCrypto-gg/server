import { describe, expect, test } from "bun:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import KittyRequest from "../src/kittyRequest";
import type Server from "../src/baseServer";
import type { tokenStore } from "../src/tokenStore";
import RateLimiter from "../src/rateLimiter";

type HandlerOptions = {
    requireSessionToken?: boolean;
    getSessionToken?: (req: Request) => string | null;
    touchOnValid?: boolean;
};

class RequestHarness extends KittyRequest<{ ok: boolean }> {
    public invoke(
        req: Request,
        res: Response,
        action: (req: Request, res: Response) => Promise<object>,
        opts: HandlerOptions = {}
    ): Promise<Response> {
        return this.handleRequest(req, res, action, opts);
    }
}

function responseFixture() {
    const observed: {
        code: number;
        body: unknown;
        headers: Record<string, string>;
    } = { code: 200, body: undefined, headers: {} };
    const result = {
        headersSent: false,
        status(code: number) { observed.code = code; return this; },
        json(body: unknown) { observed.body = body; return this; },
        setHeader(name: string, value: string) { observed.headers[name] = value; return this; }
    };
    return { res: result as unknown as Response, observed };
}
const request = (token?: string): Request =>
    ({ body: token === undefined ? {} : { sessionToken: token } }) as Request;

describe("flattened KittyRequest session guards", () => {
    function setup(options: { configured?: boolean; ready?: boolean; valid?: boolean } = {}) {
        const calls: string[] = [];
        const configured = options.configured ?? true;
        const fake = configured ? {
            waitUntilReady: async () => {
                calls.push("ready");
                if (options.ready === false) throw new Error("not ready");
            },
            tokenExistsAndValid: (token: string) => {
                calls.push("validate:" + token);
                return options.valid ?? true;
            },
            touchToken: (token: string) => { calls.push("touch:" + token); }
        } as unknown as tokenStore : undefined as unknown as tokenStore;
        const handler = new RequestHarness({} as Server, "/tmp/unused-request-test.json", fake, (_value): _value is { ok: boolean } => true);
        const action = async (): Promise<object> => {
            calls.push("action");
            return { ok: true };
        };
        return { handler, action, calls };
    }

    test("does not query token storage or token locator for unrestricted requests", async () => {
        const { handler, action, calls } = setup({ configured: false });
        const { res, observed } = responseFixture();
        const result = await handler.invoke(request(), res, action, {
            getSessionToken: () => { throw new Error("must not inspect token"); }
        });
        expect(result).toBe(res);
        expect(observed).toEqual({ code: 200, body: { ok: true }, headers: {} });
        expect(calls).toEqual(["action"]);
    });

    test("missing token storage retains its exact status and prevents action", async () => {
        const { handler, action, calls } = setup({ configured: false });
        const { res, observed } = responseFixture();
        await handler.invoke(request("abc"), res, action, { requireSessionToken: true });
        expect(observed.code).toBe(500);
        expect(observed.body).toEqual({ error: "Token store not configured." });
        expect(calls).toEqual([]);
    });

    test("unready store returns 503 before checking the token", async () => {
        const { handler, action, calls } = setup({ ready: false });
        const { res, observed } = responseFixture();
        await handler.invoke(request("abc"), res, action, { requireSessionToken: true });
        expect(observed.code).toBe(503);
        expect(observed.body).toEqual({ error: "Server initialising. Try again." });
        expect(calls).toEqual(["ready"]);
    });

    test("missing session token rejects before validation", async () => {
        const { handler, action, calls } = setup();
        const { res, observed } = responseFixture();
        await handler.invoke(request(), res, action, { requireSessionToken: true });
        expect(observed.code).toBe(422);
        expect(observed.body).toEqual({ error: "Missing sessionToken." });
        expect(calls).toEqual(["ready"]);
    });

    test("invalid token returns 403 without touching storage", async () => {
        const { handler, action, calls } = setup({ valid: false });
        const { res, observed } = responseFixture();
        await handler.invoke(request("abc"), res, action, { requireSessionToken: true });
        expect(observed.code).toBe(403);
        expect(observed.body).toEqual({ error: "Session expired." });
        expect(calls).toEqual(["ready", "validate:abc"]);
    });

    test("valid token is touched in order, unless touchOnValid is disabled", async () => {
        const { handler, action, calls } = setup();
        const { res, observed } = responseFixture();
        await handler.invoke(request("abc"), res, action, { requireSessionToken: true });
        expect(observed.code).toBe(200);
        expect(calls).toEqual(["ready", "validate:abc", "touch:abc", "action"]);

        calls.length = 0;
        const second = responseFixture();
        await handler.invoke(request("def"), second.res, action, {
            requireSessionToken: true, touchOnValid: false
        });
        expect(second.observed.code).toBe(200);
        expect(calls).toEqual(["ready", "validate:def", "action"]);
    });
});

describe("flattened rate limiter rejection handling", () => {
    function setup(allowed: boolean, customRejected = false) {
        const calls: string[] = [];
        const limiter = new RateLimiter({ filePath: "/tmp/unused-rate-limit-test.pb" });
        limiter.consume = async () => ({
            allowed, retryAfterSeconds: 7, remainingAttempts: allowed ? 1 : 0
        });
        const handler: RequestHandler = async () => { calls.push("handler"); };
        const onRejected = customRejected ? () => { calls.push("onRejected"); } : undefined;
        const wrapped = limiter.wrap({
            scope: "test", windowMs: 1000, maxAttempts: 3,
            resolveBucketKey: () => "sample-ip", onRejected
        }, handler);
        return { wrapped, calls };
    }
    const next = (() => { throw new Error("unexpected next()"); }) as NextFunction;

    test("allowed requests execute the handler without retry headers", async () => {
        const { wrapped, calls } = setup(true);
        const { res, observed } = responseFixture();
        await wrapped(request(), res, next);
        expect(calls).toEqual(["handler"]);
        expect(observed.headers).toEqual({});
    });

    test("custom rejection runs after Retry-After and skips default response", async () => {
        const { wrapped, calls } = setup(false, true);
        const { res, observed } = responseFixture();
        await wrapped(request(), res, next);
        expect(calls).toEqual(["onRejected"]);
        expect(observed.headers).toEqual({ "Retry-After": "7" });
        expect(observed.code).toBe(200);
        expect(observed.body).toBeUndefined();
    });

    test("default rejection returns 429 and skips handler", async () => {
        const { wrapped, calls } = setup(false);
        const { res, observed } = responseFixture();
        await wrapped(request(), res, next);
        expect(calls).toEqual([]);
        expect(observed.headers).toEqual({ "Retry-After": "7" });
        expect(observed.code).toBe(429);
        expect(observed.body).toEqual({
            ok: false,
            error: "Too many requests. Retry in 7 seconds."
        });
    });
});
