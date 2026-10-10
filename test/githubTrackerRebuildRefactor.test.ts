import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildAll } from "../src/githubTracker/rebuild";
import { createRebuildFlusher } from "../src/githubTracker/rebuild/storage";
import type { TrackerContext } from "../src/githubTracker/context";
import type { GitHubCommit, RepoHistory } from "../src/githubTracker/types";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
const commit = (sha: string, message: string): GitHubCommit => ({
    sha,
    html_url: "https://github.com/" + sha,
    commit: { message, author: { name: "Author " + sha, date: "2026-10-10T12:00:00Z" } }
});
async function fixture(repos: string[], rows: GitHubCommit[]) {
    const dir = await mkdtemp(join(tmpdir(), "rebuild-parity-"));
    roots.push(dir);
    const calls: string[] = [];
    const ctx = {
        owner: "kittyCrypto-gg", repos, outDir: dir,
        ensureDir: async () => { calls.push("ensure"); },
        fetchAll: async (repo: string, branch: string) => {
            calls.push("fetch:" + repo + ":" + branch); return rows;
        },
        fetchDiff: async (repo: string, sha: string) => {
            calls.push("diff:" + repo + ":" + sha); return "patch-" + sha;
        },
        tryReadmeMajorAtSha: async (repo: string, sha: string, major: number) => {
            calls.push("major:" + repo + ":" + sha + ":" + major);
            return sha === "c" ? 9 : major;
        },
        genTier: async (message: string) => {
            calls.push("tier:" + message); return "tiny" as const;
        },
        stampFromIso: (_iso: string) => "20261010-120000",
        bumpStampByOneSecond: (stamp: string) =>
            stamp.slice(0, -2) + String(Number(stamp.slice(-2)) + 1).padStart(2, "0"),
    } as unknown as TrackerContext;
    return {ctx, dir, calls};
}
async function quiet<T>(callback: () => Promise<T>): Promise<T> {
    const logger = console.log;
    console.log = () => undefined;
    try { return await callback(); } finally { console.log = logger; }
}
async function saved(dir: string): Promise<{name: string; history: RepoHistory}[]> {
    const names = (await readdir(dir)).sort();
    return await Promise.all(names.map(async name => ({
        name, history: JSON.parse(await readFile(join(dir, name), "utf8")) as RepoHistory
    })));
}

test("empty rebuild preserves result shape and writes nothing", async () => {
    const {ctx, dir, calls} = await fixture(["server"], []);
    expect(await quiet(() => rebuildAll(ctx))).toEqual({ server: [] });
    expect(await readdir(dir)).toEqual([]);
    expect(calls).toEqual(["ensure", "fetch:server:main"]);
});

test("replay retains oldest-first commit order, tags, overrides and LLM classification", async () => {
    const {ctx, dir, calls} = await fixture(["server"], [
        commit("d", "untagged"), commit("c", "!setver"),
        commit("b", "!fix"), commit("a", "!setver=4.200")
    ]);
    const result = await quiet(() => rebuildAll(ctx, "feature", 20));
    expect(result.server).toHaveLength(1);
    expect(result.server[0].commits.map(item => [item.sha, item.version])).toEqual([
        ["a", "4.200"], ["b", "4.2001"], ["c", "9.0"], ["d", "9.00001"]
    ]);
    expect((await saved(dir))[0].history.commits).toEqual(result.server[0].commits);
    expect(calls).toEqual([
        "ensure", "fetch:server:feature",
        "diff:server:a", "major:server:a:0",
        "diff:server:b", "major:server:b:0",
        "diff:server:c", "major:server:c:0",
        "diff:server:d", "major:server:d:9",
        "tier:untagged"
    ]);
});

test("one-commit chunks disambiguate identical timestamps without altering creation date", async () => {
    const {ctx, dir} = await fixture(["server"], [
        commit("c", "!skip"), commit("b", "!feat"), commit("a", "!major")
    ]);
    const result = await quiet(() => rebuildAll(ctx, "main", 1));
    const rows = await saved(dir);
    expect(rows.map(item=>item.name)).toEqual([
        "20261010-120000-GithubTracker-kittyCrypto-gg-server.json",
        "20261010-120001-GithubTracker-kittyCrypto-gg-server.json",
        "20261010-120002-GithubTracker-kittyCrypto-gg-server.json"
    ]);
    expect(rows.map(item=>item.history.commits.map(c=>c.sha))).toEqual([["a"],["b"],["c"]]);
    expect(rows.map(item=>item.history.createdAt)).toEqual([
        "2026-10-10T12:00:00Z", "2026-10-10T12:00:00Z", "2026-10-10T12:00:00Z"
    ]);
    expect(result.server.map(item=>item.commits[0].version)).toEqual(["1.0", "1.01", "1.01"]);
});

test("remainder chunk and multiple repos preserve original file boundaries and independent versions", async () => {
    const {ctx, dir} = await fixture(["first", "second"], [
        commit("c", "!fix"), commit("b", "!fix"), commit("a", "!fix")
    ]);
    const result = await quiet(() => rebuildAll(ctx, "develop", 2));
    expect(Object.keys(result)).toEqual(["first", "second"]);
    expect(result.first.map(h=>h.commits.map(c=>c.sha))).toEqual([["a","b"],["c"]]);
    expect(result.second.map(h=>h.commits.map(c=>c.sha))).toEqual([["a","b"],["c"]]);
    expect(result.first[0].commits[0].version).toBe("0.0001");
    expect(result.second[0].commits[0].version).toBe("0.0001");
    expect((await saved(dir)).length).toBe(4);
});

test("diff failures propagate before an incomplete chunk is written", async () => {
    const {ctx, dir} = await fixture(["server"], [commit("a", "!fix")]);
    ctx.fetchDiff = async () => { throw new Error("fetch failed"); };
    await expect(quiet(() => rebuildAll(ctx))).rejects.toThrow("fetch failed");
    expect(await readdir(dir)).toEqual([]);
});

test("empty flusher never writes or advances history", async () => {
    const {ctx, dir} = await fixture(["server"], []);
    const histories: RepoHistory[] = [];
    await createRebuildFlusher(ctx, "server", histories)([], "2026-10-10T12:00:00Z");
    expect(histories).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
});
