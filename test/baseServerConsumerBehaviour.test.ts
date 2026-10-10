import { describe, expect, test } from "bun:test";
import type { Express, Request } from "express";
import type https from "node:https";
import Server from "../src/baseServer";
import { Server as PublicServer } from "../src/index";

// This contract is based on actual downstream consumers, notably Hostel4Pets.
// No TLS constructor is executed: downstream runtime configuration owns certificates.
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2) ? true : false;
type ConstructorContract = Assert<Equal<
    ConstructorParameters<typeof Server>,
    [host: string, port?: number, allowedOrigins?: string | string[]]
>>;
type StartContract = Assert<Equal<ReturnType<Server["start"]>, Promise<void>>>;
type OriginContract = Assert<Equal<Server["allowedOriginsList"], string[]>>;

class DownstreamServer extends Server {
    public inspectProtected(): [https.Server, string, number | undefined] {
        return [this.server, this.host, this.port];
    }

    public async probe(from: number, to: number): Promise<number> {
        return await this.findFreePort(from, to);
    }
}

interface Internals {
    allowedOrigins: Set<string>;
    allowedMethods: Set<string>;
    publicCorsRoutes: Map<string, Set<string>>;
    isPublicCorsRequest(req: Request): boolean;
    getPublicCorsMethods(path: string): string[];
    readRequestedCorsMethod(req: Request): string | undefined;
    routeMatches(route: string, path: string): boolean;
    isPortFree(port: number): Promise<boolean>;
}

function fakeServer(): Server & Internals {
    return Object.assign(Object.create(DownstreamServer.prototype), {
        host: "example.org",
        port: 443,
        allowedOrigins: new Set<string>(),
        allowedMethods: new Set<string>(["GET"]),
        publicCorsRoutes: new Map<string, Set<string>>()
    }) as Server & Internals;
}

function request(method: string, path: string, preflight?: string): Request {
    return {
        method,
        path,
        header: (name: string) =>
            name === "access-control-request-method" ? preflight : undefined
    } as unknown as Request;
}

describe("Server externally consumed runtime contract", () => {
    test("package root and class identity stay the same", () => {
        expect(PublicServer).toBe(Server);
        for (const name of [
            "constructor", "registerRoute", "addAllowedOrigins", "addCorsOrigin",
            "addPubCorsRte", "start", "logEndpoints", "getPort", "getHost",
            "findFreePort"
        ]) {
            expect(typeof Object.getOwnPropertyDescriptor(Server.prototype, name)?.value)
                .toBe("function");
        }
        expect(typeof Object.getOwnPropertyDescriptor(Server.prototype, "baseUrl")?.get)
            .toBe("function");
        expect(typeof Object.getOwnPropertyDescriptor(Server.prototype, "allowedOriginsList")?.get)
            .toBe("function");
    });

    test("server methods retain origin storage, URL, port and static route semantics", () => {
        const server = fakeServer();
        const calls: [string, string, unknown][] = [];
        server.app = {
            get: (path: string, handler: unknown) => { calls.push(["GET", path, handler]); },
            post: (path: string, handler: unknown) => { calls.push(["POST", path, handler]); },
            use: (path: string, handler: unknown) => { calls.push(["STATIC", path, handler]); }
        } as unknown as Express;

        server.addAllowedOrigins(["https://a.example", "https://b.example"]);
        server.addAllowedOrigins("https://a.example");
        server.addCorsOrigin("https://c.example", "POST");
        expect(server.allowedOriginsList).toEqual([
            "https://a.example", "https://b.example", "https://c.example"
        ]);
        expect([...server.allowedMethods]).toEqual(["GET", "POST"]);
        expect(server.getHost()).toBe("example.org");
        expect(server.getPort()).toBe(443);
        expect(server.baseUrl).toBe("https://example.org:443");

        const handler = () => undefined;
        server.registerRoute("/status", "GET", handler);
        server.registerRoute("/submit", "POST", handler);
        server.registerRoute("/files", "GET", "/tmp/files");
        expect(calls.map(([method, path]) => [method, path])).toEqual([
            ["GET", "/status"], ["POST", "/submit"], ["STATIC", "/files"]
        ]);
        expect(calls[0]?.[2]).toBe(handler);
        expect(typeof calls[2]?.[2]).toBe("function");
    });

    test("preflight and public CORS matching keep original method and path restrictions", () => {
        const server = fakeServer();
        server.addPubCorsRte("/visits/*", ["GET", "OPTIONS"]);
        server.addPubCorsRte("/visits/*", ["POST", "GET"]);
        server.addPubCorsRte("/status", "GET");

        expect([...server.publicCorsRoutes.get("/visits/*")!])
            .toEqual(["GET", "OPTIONS", "POST"]);
        expect(server.routeMatches("/visits/*", "/visits/log")).toBe(true);
        expect(server.routeMatches("/visits/*", "/visits/")).toBe(false);
        expect(server.routeMatches("/status", "/status/")).toBe(false);

        expect(server.isPublicCorsRequest(request("GET", "/visits/log"))).toBe(true);
        expect(server.isPublicCorsRequest(request("POST", "/visits/log"))).toBe(true);
        expect(server.isPublicCorsRequest(request("DELETE", "/visits/log"))).toBe(false);
        expect(server.isPublicCorsRequest(request("OPTIONS", "/visits/log", "GET"))).toBe(true);
        expect(server.isPublicCorsRequest(request("OPTIONS", "/visits/log", "PATCH"))).toBe(false);
        expect(server.isPublicCorsRequest(request("OPTIONS", "/visits/log"))).toBe(false);
        expect(server.isPublicCorsRequest(request("GET", "/visit/log"))).toBe(false);
        expect(server.readRequestedCorsMethod(request("get", "/visits/log"))).toBe("GET");
        expect(server.getPublicCorsMethods("/visits/log"))
            .toEqual(["GET", "OPTIONS", "POST"]);
    });

    test("protected free-port hook remains subclassable and respects bounds", async () => {
        const server = fakeServer();
        const tried: number[] = [];
        server.isPortFree = async port => {
            tried.push(port);
            return port === 3032;
        };
        const child = server as unknown as DownstreamServer;
        expect(await child.probe(3030, 3035)).toBe(3032);
        expect(tried).toEqual([3030, 3031, 3032]);
        await expect(child.probe(3033, 3034)).rejects.toThrow("No free ports available");
    });

    test("logger retains top-level and mounted Express router output", () => {
        const server = fakeServer();
        const output: string[] = [];
        server.app = {
            _router: { stack: [
                { route: { path: "/hello", methods: { get: true } } },
                { name: "router", handle: { stack: [
                    { route: { path: "/chat", methods: { post: true } } }
                ] } }
            ] }
        } as unknown as Express;
        const original = console.log;
        console.log = (...args: unknown[]) => { output.push(args.map(String).join(" ")); };
        try {
            server.logEndpoints();
        } finally {
            console.log = original;
        }
        expect(output).toEqual([
            "Endpoint: https://example.org:443/hello, Method: GET",
            "Endpoint: https://example.org:443/chat, Method: POST"
        ]);
    });
});
