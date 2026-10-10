import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tokens from "../src/tokenStore/paths";
import * as visits from "../src/visits/paths";
import * as rate from "../src/rateLimiter/paths";
import type { TokenStoreContext } from "../src/tokenStore/context";
import type { VisitsContext } from "../src/visits/context";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(dir => rm(dir, {recursive: true, force: true})));
});
const tokenContext = {replaceExtension: (file: string, ext: string) => tokens.replaceExtension({} as TokenStoreContext, file, ext)} as TokenStoreContext;
const visitsContext = {replaceExtension: (file: string, ext: string) => visits.replaceExtension({} as VisitsContext, file, ext)} as VisitsContext;

test("all three path resolvers keep original .json, .pb and unknown-extension mapping", () => {
    const files = [
        [tokens.resolveStorePaths(tokenContext, "/tmp/a.json"), "/tmp/a.pb", "/tmp/a.json"],
        [visits.resolveStorePaths(visitsContext, "/tmp/a.json"), "/tmp/a.pb", "/tmp/a.json"],
        [rate.resolveStorePaths("/tmp/a.json"), "/tmp/a.pb", "/tmp/a.json"],
        [tokens.resolveStorePaths(tokenContext, "/tmp/a.PB"), "/tmp/a.PB", "/tmp/a.json"],
        [visits.resolveStorePaths(visitsContext, "/tmp/a.PB"), "/tmp/a.PB", "/tmp/a.json"],
        [rate.resolveStorePaths("/tmp/a.PB"), "/tmp/a.PB", "/tmp/a.json"],
        [tokens.resolveStorePaths(tokenContext, "/tmp/a.data"), "/tmp/a.data.pb", "/tmp/a.data.json"],
        [visits.resolveStorePaths(visitsContext, "/tmp/a.data"), "/tmp/a.data.pb", "/tmp/a.data.json"],
        [rate.resolveStorePaths("/tmp/a.data"), "/tmp/a.data.pb", "/tmp/a.data.json"],
    ] as const;
    for (const [actual, proto, json] of files) {
        expect(actual).toEqual({protoBuffFilePath:proto, legacyJsonFilePath:json});
    }
});

test("each subsystem keeps its own default name and whitespace treatment", () => {
    expect(tokens.resolveStorePaths(tokenContext, "  ").protoBuffFilePath).toBe(path.resolve("data/sessionTokens.pb"));
    expect(rate.resolveStorePaths(" ").protoBuffFilePath).toBe(path.resolve("data/rateLimits.pb"));
    expect(visits.resolveStorePaths(visitsContext, " ").protoBuffFilePath).toBe(" .pb");
    expect(visits.resolveStorePaths(visitsContext, "").protoBuffFilePath).toBe(".pb");
    expect(visits.resolveStorePaths(visitsContext, undefined).protoBuffFilePath).toBe(path.resolve("data/visits.pb"));
});

test("token and visits contexts retain their virtual replaceExtension call sites", () => {
    const tokenCalls: string[] = [];
    const visitCalls: string[] = [];
    const tc = { replaceExtension: (file:string, ext:string) => {
        tokenCalls.push(file + ":" + ext);
        return "token-custom";
    }} as TokenStoreContext;
    const vc = { replaceExtension: (file:string, ext:string) => {
        visitCalls.push(file + ":" + ext);
        return "visits-custom";
    }} as VisitsContext;
    expect(tokens.resolveStorePaths(tc, "test.json").protoBuffFilePath).toBe("token-custom");
    expect(visits.resolveStorePaths(vc, "test.json").protoBuffFilePath).toBe("visits-custom");
    expect(tokenCalls).toEqual(["test.json:.pb"]);
    expect(visitCalls).toEqual(["test.json:.pb"]);
});

test("only the token store treats ENOTDIR as missing while all three ignore ENOENT", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "paths-parity-"));
    roots.push(dir);
    const file = path.join(dir, "parent-is-file");
    const nested = path.join(file, "child");
    await writeFile(file, "data");
    expect(await tokens.fileExists(tokenContext, nested)).toBe(false);
    await expect(visits.fileExists(visitsContext, nested)).rejects.toMatchObject({code:"ENOTDIR"});
    await expect(rate.fileExists(nested)).rejects.toMatchObject({code:"ENOTDIR"});
    const missing = path.join(dir, "absent");
    expect(await tokens.fileExists(tokenContext, missing)).toBe(false);
    expect(await visits.fileExists(visitsContext, missing)).toBe(false);
    expect(await rate.fileExists(missing)).toBe(false);
    expect(await tokens.fileExists(tokenContext, file)).toBe(true);
    expect(await visits.fileExists(visitsContext, file)).toBe(true);
    expect(await rate.fileExists(file)).toBe(true);
});
