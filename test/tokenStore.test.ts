import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import type Server from "../src/baseServer";
import { tokenStore, type TokenStoreJson } from "../src/tokenStore";
import { sessionTokensProtoCodec } from "../src/tokenStore/schema";

const roots: string[] = [];
const temp = async (): Promise<string> => {
    const name = await mkdtemp(path.join(tmpdir(), "session-tokens-"));
    roots.push(name);
    return name;
};
const current = new Set<string>();
const fakeServer = {} as Server;
const formatLegacyDate = (value: Date): string => {
    const pad = (n: number, d = 2): string => String(n).padStart(d, "0");
    return `${value.getFullYear()}.${pad(value.getMonth() + 1)}.${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.${pad(value.getMilliseconds(), 3)}`;
};
afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
    current.clear();
});

describe("session token store compatibility", () => {
    test("retains all five original named/type exports at the historical path", async () => {
        const filename = path.resolve(import.meta.dir, "../src/tokenStore.ts");
        const source = ts.createSourceFile(filename, await readFile(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const symbols: string[] = [];
        for (const node of source.statements) {
            if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
                symbols.push(...node.exportClause.elements.map(element => element.name.text));
            }
            if (ts.isClassDeclaration(node) && node.name && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
                symbols.push(node.name.text);
            }
        }
        expect(symbols.sort()).toEqual(["SessionTokenSink", "SessionTokenStoreOpts", "TokenMeta", "TokenStoreJson", "tokenStore"].sort());
        for (const name of ["init", "waitUntilReady", "tokenExistsAndValidAsync", "dispose", "touchToken", "dropToken", "tokenExistsAndValid", "getExpiryMs"]) {
            expect(typeof (tokenStore.prototype as unknown as Record<string, unknown>)[name]).toBe("function");
        }
    });

    test("waitUntilReady still rejects before init", async () => {
        const root = await temp();
        const store = new tokenStore(fakeServer, current, () => {}, { filePath: path.join(root, "no-init.pb") });
        await expect(store.waitUntilReady()).rejects.toThrow("tokenStore.init() was not called.");
        store.dispose();
    });

    test("JSON legacy tokens migrate to original protobuf schema without losing expiry", async () => {
        const root = await temp();
        const legacyFile = path.join(root, "tokens.json");
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const input: TokenStoreJson = {
            version: 1,
            tokens: {
                good: { expiresAt: formatLegacyDate(expiresAt) },
                invalid: { expiresAt: "not a timestamp" },
                expired: { expiresAt: formatLegacyDate(new Date(Date.now() - 60_000)) }
            }
        };
        await writeFile(legacyFile, JSON.stringify(input));
        const callbacks: string[][] = [];
        const tokens = new Set<string>();
        const store = new tokenStore(fakeServer, tokens, set => callbacks.push([...set]), {
            filePath: legacyFile,
            cleanupIntervalMs: 1_000_000
        });
        try {
            store.init();
            await store.waitUntilReady();
            expect([...tokens]).toEqual(["good"]);
            expect(store.getExpiryMs("good")).toBe(expiresAt.getTime());
            expect(await store.tokenExistsAndValidAsync("good")).toBe(true);
            expect(callbacks).toEqual([["good"]]);
            const encoded = await readFile(path.join(root, "tokens.pb"));
            const decoded = sessionTokensProtoCodec.decode(encoded);
            expect(decoded.version).toBe(1);
            expect(Object.keys(decoded.tokens)).toEqual(["good"]);
            expect(decoded.tokens.good.expiresAtMs).toBe(expiresAt.getTime());
            expect((await stat(path.join(root, "tokens.pb"))).mode & 0o777).toBe(0o600);
            expect(JSON.parse(await readFile(legacyFile, "utf8"))).toEqual(input);
        } finally {
            store.dispose();
        }
    });

    test("existing protobuf state wins over legacy JSON without being replaced", async () => {
        const root = await temp(), pbFile = path.join(root, "tokens.pb");
        const expiry = Date.now() + 3_600_000;
        await writeFile(pbFile, sessionTokensProtoCodec.encode({
            version: 1,
            tokens: { retained: { expiresAtMs: expiry } }
        }));
        await writeFile(path.join(root, "tokens.json"), JSON.stringify({
            version: 1,
            tokens: { older: { expiresAt: formatLegacyDate(new Date(expiry)) } }
        }));
        const tokens = new Set<string>();
        const store = new tokenStore(fakeServer, tokens, () => {}, { filePath: pbFile });
        try {
            store.init();
            await store.waitUntilReady();
            expect([...tokens]).toEqual(["retained"]);
            expect(store.getExpiryMs("retained")).toBe(expiry);
            expect(store.getExpiryMs("older")).toBeNull();
        } finally {
            store.dispose();
        }
    });

    test("touch/drop retain callbacks, validation and asynchronous protobuf persistence", async () => {
        const root = await temp(), pbFile = path.join(root, "session.pb");
        const events: string[][] = [];
        const tokens = new Set<string>();
        const store = new tokenStore(fakeServer, tokens, set => events.push([...set]), {
            filePath: pbFile, ttlMs: 120_000, saveDebounceMs: 3, cleanupIntervalMs: 1_000_000
        });
        try {
            store.init();
            await store.waitUntilReady();
            store.touchToken("new-token");
            expect(store.tokenExistsAndValid("new-token")).toBe(true);
            expect(tokens.has("new-token")).toBe(true);
            expect(events.at(-1)).toEqual(["new-token"]);
            expect(store.getExpiryMs("new-token")).toBeGreaterThan(Date.now());
            await (store as unknown as { saveTokenStore: () => Promise<void> }).saveTokenStore();
            expect(sessionTokensProtoCodec.decode(await readFile(pbFile)).tokens["new-token"].expiresAtMs)
                .toBe(store.getExpiryMs("new-token"));
            store.dropToken("new-token");
            expect(store.tokenExistsAndValid("new-token")).toBe(false);
            expect(store.getExpiryMs("new-token")).toBeNull();
            expect(events.at(-1)).toEqual([]);
            await (store as unknown as { saveTokenStore: () => Promise<void> }).saveTokenStore();
            expect(Object.keys(sessionTokensProtoCodec.decode(await readFile(pbFile)).tokens)).toEqual([]);
        } finally {
            store.dispose();
        }
    });

    test("invalid stored expiries are dropped without changing the schema", () => {
        const instance = new tokenStore(fakeServer, current, () => {}, { ttlMs: 1 });
        const internal = instance as unknown as {
            normaliseStoredState: (v: unknown) => { version: 1; tokens: Record<string, { expiresAtMs: number }> };
            normaliseLegacyJsonState: (v: unknown) => { version: 1; tokens: Record<string, { expiresAtMs: number }> };
        };
        expect(internal.normaliseStoredState({
            version: 5,
            tokens: { ok: { expiresAtMs: 1234.9 }, invalid: { expiresAtMs: -2 }, bad: { expiresAtMs: "abc" } }
        })).toEqual({ version: 1, tokens: { ok: { expiresAtMs: 1234 } } });
        expect(internal.normaliseLegacyJsonState({ tokens: null })).toEqual({ version: 1, tokens: {} });
        expect(internal.normaliseStoredState(null)).toEqual({ version: 1, tokens: {} });
        instance.dispose();
    });
    test("scheduled debounce persists a new token without manually saving", async () => {
        const root = await temp();
        const filePath = path.join(root, "debounce.pb");
        const tokens = new Set<string>();
        const store = new tokenStore(fakeServer, tokens, () => {}, {
            filePath, saveDebounceMs: 5, cleanupIntervalMs: 1_000_000
        });
        try {
            store.init();
            await store.waitUntilReady();
            store.touchToken("automatically-saved");
            await Bun.sleep(100);
            const saved = sessionTokensProtoCodec.decode(await readFile(filePath));
            expect(saved.tokens["automatically-saved"].expiresAtMs).toBe(store.getExpiryMs("automatically-saved"));
        } finally {
            store.dispose();
        }
    });

    test("background cleanup expires tokens and updates the original set", async () => {
        const root = await temp();
        const tokens = new Set<string>();
        const callbacks: string[][] = [];
        const store = new tokenStore(fakeServer, tokens, changed => callbacks.push([...changed]), {
            filePath: path.join(root, "cleanup.pb"),
            ttlMs: 15, cleanupIntervalMs: 10, saveDebounceMs: 5
        });
        try {
            store.init();
            await store.waitUntilReady();
            store.touchToken("short-lived");
            expect(tokens.has("short-lived")).toBe(true);
            await Bun.sleep(110);
            expect(store.tokenExistsAndValid("short-lived")).toBe(false);
            expect(tokens.has("short-lived")).toBe(false);
            expect(store.getExpiryMs("short-lived")).toBeNull();
            expect(callbacks.at(-1)).toEqual([]);
        } finally {
            store.dispose();
        }
    });

});
