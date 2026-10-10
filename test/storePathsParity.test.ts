import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tokens from "../src/tokenStore/paths";
import * as visits from "../src/visits/paths";
import * as limits from "../src/rateLimiter/paths";
import type { TokenStoreContext } from "../src/tokenStore/context";
import type { VisitsContext } from "../src/visits/context";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

function tokenContext(replaceExtension = (value: string, ext: string) => tokens.replaceExtension({} as TokenStoreContext, value, ext)): TokenStoreContext {
    return { replaceExtension } as TokenStoreContext;
}
function visitContext(replaceExtension = (value: string, ext: string) => visits.replaceExtension({} as VisitsContext, value, ext)): VisitsContext {
    return { replaceExtension } as VisitsContext;
}

describe("cross-module protobuf and legacy JSON path parity", () => {
    test("all three historical resolveStorePaths entrypoints preserve their default filenames", () => {
        expect(tokens.resolveStorePaths(tokenContext(), undefined)).toEqual({
            protoBuffFilePath: path.resolve(process.cwd(), "data", "sessionTokens.pb"),
            legacyJsonFilePath: path.resolve(process.cwd(), "data", "sessionTokens.json")
        });
        expect(visits.resolveStorePaths(visitContext(), undefined)).toEqual({
            protoBuffFilePath: path.resolve(process.cwd(), "data", "visits.pb"),
            legacyJsonFilePath: path.resolve(process.cwd(), "data", "visits.json")
        });
        expect(limits.resolveStorePaths(undefined)).toEqual({
            protoBuffFilePath: path.resolve(process.cwd(), "data", "rateLimits.pb"),
            legacyJsonFilePath: path.resolve(process.cwd(), "data", "rateLimits.json")
        });
    });

    test("suffix resolution and extension replacement remain identical across consumers", () => {
        const candidates = ["data/state.json", "data/state.pb", "data/state", "data/archive.db", "data/MIXED.JSON"];
        for (const candidate of candidates) {
            const a = tokens.resolveStorePaths(tokenContext(), candidate);
            expect(visits.resolveStorePaths(visitContext(), candidate)).toEqual(a);
            expect(limits.resolveStorePaths(candidate)).toEqual(a);
        }
        expect(tokens.replaceExtension(tokenContext(), "dir/file.name.json", ".pb")).toBe("dir/file.name.pb");
        expect(visits.replaceExtension(visitContext(), "dir/file.name.json", ".pb")).toBe("dir/file.name.pb");
        expect(limits.replaceExtension("dir/file.name.json", ".pb")).toBe("dir/file.name.pb");
    });

    test("token and rate limiters trim empty options, but visits retains its original raw path", () => {
        expect(tokens.resolveStorePaths(tokenContext(), "  ").protoBuffFilePath).toBe(
            path.resolve(process.cwd(), "data", "sessionTokens.pb")
        );
        expect(limits.resolveStorePaths("  ").protoBuffFilePath).toBe(
            path.resolve(process.cwd(), "data", "rateLimits.pb")
        );
        expect(visits.resolveStorePaths(visitContext(), "  ").protoBuffFilePath).toBe("  .pb");
        expect(visits.resolveStorePaths(visitContext(), "").protoBuffFilePath).toBe(".pb");
    });

    test("token and visits preserve overridden instance extension hooks", () => {
        const tokenCalls: string[] = [], visitCalls: string[] = [];
        const tctx = tokenContext((file, ext) => {
            tokenCalls.push(file + ":" + ext);
            return "token-override" + ext;
        });
        const vctx = visitContext((file, ext) => {
            visitCalls.push(file + ":" + ext);
            return "visit-override" + ext;
        });
        expect(tokens.resolveStorePaths(tctx, "input.json").protoBuffFilePath).toBe("token-override.pb");
        expect(visits.resolveStorePaths(vctx, "input.pb").legacyJsonFilePath).toBe("visit-override.json");
        expect(tokenCalls).toEqual(["input.json:.pb"]);
        expect(visitCalls).toEqual(["input.pb:.json"]);
    });

    test("exists checks preserve ENOENT/ENOTDIR policy, rather than broadening security exceptions", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "path-parity-"));
        dirs.push(dir);
        const present = path.join(dir, "present");
        await writeFile(present, "hello");
        const missing = path.join(dir, "missing");
        const notDir = path.join(present, "file");
        expect(await tokens.fileExists(tokenContext(), present)).toBe(true);
        expect(await visits.fileExists(visitContext(), present)).toBe(true);
        expect(await limits.fileExists(present)).toBe(true);
        expect(await tokens.fileExists(tokenContext(), missing)).toBe(false);
        expect(await visits.fileExists(visitContext(), missing)).toBe(false);
        expect(await limits.fileExists(missing)).toBe(false);
        expect(await tokens.fileExists(tokenContext(), notDir)).toBe(false);
        await expect(visits.fileExists(visitContext(), notDir)).rejects.toMatchObject({ code: "ENOTDIR" });
        await expect(limits.fileExists(notDir)).rejects.toMatchObject({ code: "ENOTDIR" });
    });
});
