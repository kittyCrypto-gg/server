import { describe, expect, test } from "bun:test";
import type Server from "../src/baseServer";
import { tokenStore, type SessionTokenStoreOpts } from "../src/tokenStore";
import type { TokenStoreContext } from "../src/tokenStore/context";

const expectedPrototypeMethods = [
  "constructor",
  "constructor",
  "createStoredState",
  "dispose",
  "dropToken",
  "ensureMigrated",
  "fileExists",
  "getExpiryMs",
  "hasTokens",
  "init",
  "isRecord",
  "loadTokenStore",
  "migrateLegacyJsonIfNeeded",
  "normaliseLegacyJsonState",
  "normaliseLegacyTokenMeta",
  "normaliseStoredState",
  "normaliseStoredTokenMeta",
  "parseTimeString",
  "readLegacyJsonStore",
  "replaceExtension",
  "resolveStorePaths",
  "saveTokenStore",
  "scheduleSaveTokenStore",
  "startCleanup",
  "tokenExistsAndValid",
  "tokenExistsAndValidAsync",
  "touchToken",
  "waitUntilReady"
] as const;
const server = {} as Server;
function subject(options: SessionTokenStoreOpts = {}) {
    const tokens = new Set<string>();
    const notifications: Set<string>[] = [];
    const events: string[][] = [];
    const store = new tokenStore(server, tokens, changed => {
        notifications.push(changed);
        events.push([...changed]);
    }, options);
    return { tokens, notifications, events, store, internals: store as unknown as TokenStoreContext };
}

describe("tokenStore deep-import consumer contract", () => {
    test("every existing public and internal hook remains on tokenStore.prototype", () => {
        expect(Object.getOwnPropertyNames(tokenStore.prototype).sort()).toEqual([...expectedPrototypeMethods]);
        const instance = subject().store;
        for (const method of expectedPrototypeMethods) {
            expect(typeof (instance as unknown as Record<string, unknown>)[method]).toBe("function");
        }
        instance.dispose();
    });

    test("constructor retains the identical externally supplied server and Set references", () => {
        const {store, tokens, internals, notifications} = subject({ttlMs: 120000, saveDebounceMs: 10, cleanupIntervalMs: 60000});
        expect(internals.server).toBe(server);
        expect(internals.sessionTokens).toBe(tokens);
        expect(internals.ttlMs).toBe(120000);
        expect(internals.saveDebounceMs).toBe(10);
        expect(internals.cleanupIntervalMs).toBe(60000);
        expect(internals.initialised).toBe(false);
        expect(notifications).toEqual([]);
        store.dispose();
    });

    test("init remains synchronous, idempotent and calls load, notify, cleanup in order", async () => {
        const {store, tokens, notifications, internals} = subject();
        const calls: string[] = [];
        internals.loadTokenStore = async () => { calls.push("load"); };
        internals.startCleanup = () => { calls.push("cleanup"); };
        internals.onTokensChanged = changed => { calls.push("notify"); notifications.push(changed); };
        expect(store.init()).toBeUndefined();
        store.init();
        await store.waitUntilReady();
        expect(internals.initialised).toBe(true);
        expect(calls).toEqual(["load", "notify", "cleanup"]);
        expect(notifications).toEqual([tokens]);
        store.dispose();
    });

    test("readiness methods preserve rejection before init and async validity after init", async () => {
        const {store, internals} = subject();
        await expect(store.waitUntilReady()).rejects.toThrow("tokenStore.init() was not called.");
        await expect(store.tokenExistsAndValidAsync("not-issued")).rejects.toThrow("tokenStore.init() was not called.");
        internals.loadTokenStore = async () => undefined;
        internals.startCleanup = () => undefined;
        store.init();
        expect(await store.tokenExistsAndValidAsync("not-issued")).toBe(false);
        store.dispose();
    });

    test("touch/drop preserve callback timing, shared Set identity and save order", () => {
        const {store, internals, tokens, notifications, events} = subject({ttlMs: 60000});
        const saves: string[] = [];
        internals.scheduleSaveTokenStore = () => { saves.push("save"); };
        const before = Date.now();
        store.touchToken("a");
        const expiry = store.getExpiryMs("a");
        expect(expiry).toBeGreaterThanOrEqual(before + 60000);
        expect(expiry).toBeLessThanOrEqual(Date.now() + 60000);
        expect(store.tokenExistsAndValid("a")).toBe(true);
        expect(tokens.has("a")).toBe(true);
        store.dropToken("a");
        expect(store.tokenExistsAndValid("a")).toBe(false);
        expect(store.getExpiryMs("a")).toBeNull();
        expect(events).toEqual([["a"], []]);
        expect(notifications).toEqual([tokens, tokens]);
        expect(saves).toEqual(["save", "save"]);
        store.dispose();
    });

    test("validation does not mutate expired entries before scheduled cleanup", () => {
        const {store, internals, tokens} = subject();
        internals.tokenMeta.set("expired", {expiresAtMs: Date.now() - 1});
        tokens.add("expired");
        expect(store.tokenExistsAndValid("expired")).toBe(false);
        expect(store.getExpiryMs("expired")).toBeLessThan(Date.now());
        expect(tokens.has("expired")).toBe(true);
        expect(internals.tokenMeta.has("expired")).toBe(true);
        store.dispose();
    });

    test("dispose clears both pending timers without deleting tokens or notifying", () => {
        const {store, internals, tokens, events} = subject();
        tokens.add("retained");
        internals.savePending = setTimeout(() => {}, 60000);
        internals.cleanupTimer = setInterval(() => {}, 60000);
        store.dispose();
        expect(internals.savePending).toBeNull();
        expect(internals.cleanupTimer).toBeNull();
        expect([...tokens]).toEqual(["retained"]);
        expect(events).toEqual([]);
        store.dispose();
    });
});
