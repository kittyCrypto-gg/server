import { expect, test } from "bun:test";
import type { Express, Request } from "express";
import {
    type CorsContext, isKnownMethod, routeMatches,
    readRequestedCorsMethod, isPublicCorsRequest, getPublicCorsMethods
} from "../src/baseServer/cors";
import { findFreePort } from "../src/baseServer/ports";
import { logEndpoints } from "../src/baseServer/logging";
import type { methods } from "../src/baseServer/types";

function context(): CorsContext {
    const ctx: CorsContext = {
        publicCorsRoutes: new Map<string, Set<methods>>([
            ["/chat/*", new Set(["GET", "OPTIONS"])],
            ["/private", new Set(["POST"])]
        ]),
        isKnownMethod: (v): v is methods => isKnownMethod(ctx, v),
        routeMatches: (route, path) => routeMatches(ctx, route, path),
        readRequestedCorsMethod: req => readRequestedCorsMethod(ctx, req)
    };
    return ctx;
}

function req(method: string, path: string, preflight?: string): Request {
    return {
        method, path,
        header: (name: string) => name === "access-control-request-method" ? preflight : undefined
    } as unknown as Request;
}

test("CORS route matching preserves exact paths and strict wildcard prefix boundary", () => {
    const ctx = context();
    expect(routeMatches(ctx, "/private", "/private")).toBe(true);
    expect(routeMatches(ctx, "/private", "/private/")).toBe(false);
    expect(routeMatches(ctx, "/chat/*", "/chat/messages")).toBe(true);
    expect(routeMatches(ctx, "/chat/*", "/chat/")).toBe(false);
    expect(routeMatches(ctx, "/chat/*", "/chat")).toBe(false);
    expect(routeMatches(ctx, "/chat/*", "/chats/messages")).toBe(false);
});

test("CORS guards preserve GET and preflight interpretation without granting unknown methods", () => {
    const ctx = context();
    expect(isPublicCorsRequest(ctx, req("GET", "/chat/updates"))).toBe(true);
    expect(isPublicCorsRequest(ctx, req("POST", "/chat/updates"))).toBe(false);
    expect(isPublicCorsRequest(ctx, req("OPTIONS", "/chat/updates", "GET"))).toBe(true);
    expect(isPublicCorsRequest(ctx, req("OPTIONS", "/chat/updates", "POST"))).toBe(false);
    expect(isPublicCorsRequest(ctx, req("OPTIONS", "/chat/updates", "INVALID"))).toBe(false);
    expect(isPublicCorsRequest(ctx, req("OPTIONS", "/chat/updates"))).toBe(false);
    expect(isPublicCorsRequest(ctx, req("POST", "/private"))).toBe(true);
    expect(isKnownMethod(ctx, "PATCH")).toBe(false);
    expect(readRequestedCorsMethod(ctx, req("get", "/chat/updates"))).toBe("GET");
});

test("public CORS methods aggregate matching routes in original insertion order", () => {
    const ctx = context();
    ctx.publicCorsRoutes.set("/chat/updates", new Set(["POST", "GET"]));
    expect(getPublicCorsMethods(ctx, "/chat/updates")).toEqual(["GET", "OPTIONS", "POST"]);
    expect(getPublicCorsMethods(ctx, "/chat/")).toEqual([]);
});

test("port discovery retains configured search bounds, ordering and no-port exception", async () => {
    const tried: number[] = [];
    const candidate = await findFreePort(async port => {
        tried.push(port);
        return port === 3002;
    }, 3000, 3004);
    expect(candidate).toBe(3002);
    expect(tried).toEqual([3000, 3001, 3002]);
    await expect(findFreePort(async () => false, 3000, 3001)).rejects.toThrow("No free ports available");
});

test("endpoint logger preserves Express route and nested router representations", () => {
    const messages: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { messages.push(args.map(String).join(" ")); };
    try {
        const app = { _router: { stack: [
            { route: { path: "/status", methods: { get: true } } },
            { name: "router", handle: { stack: [
                { route: { path: "/chat", methods: { post: true } } }
            ] } }
        ] } } as unknown as Express;
        logEndpoints(app, "localhost", 3000);
        expect(messages).toEqual([
            "Endpoint: https://localhost:3000/status, Method: GET",
            "Endpoint: https://localhost:3000/chat, Method: POST"
        ]);
    } finally {
        console.log = original;
    }
});
