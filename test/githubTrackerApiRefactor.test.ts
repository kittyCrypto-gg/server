import { describe, expect, test } from "bun:test";
import { getHeaders, parseLink, normCommItems, fetchCommItms, fetchAll, getMdVer, fetchCommits, tryReadmeMajorAtSha, fetchDiff } from "../src/githubTracker/githubApi";
import * as responses from "../src/githubTracker/githubApi/responses";
import * as pagination from "../src/githubTracker/githubApi/pagination";
import * as readmes from "../src/githubTracker/githubApi/readmes";
import * as commits from "../src/githubTracker/githubApi/commits";
import type { TrackerContext } from "../src/githubTracker/context";
import type { GitHubCommit } from "../src/githubTracker/types";

describe("GitHub API module extraction compatibility", () => {
    test("the historical entrypoint re-exports every original operation unchanged", () => {
        expect(getHeaders).toBe(responses.getHeaders);
        expect(parseLink).toBe(responses.parseLink);
        expect(normCommItems).toBe(responses.normCommItems);
        expect(fetchCommItms).toBe(pagination.fetchCommItms);
        expect(fetchAll).toBe(pagination.fetchAll);
        expect(getMdVer).toBe(readmes.getMdVer);
        expect(tryReadmeMajorAtSha).toBe(readmes.tryReadmeMajorAtSha);
        expect(fetchCommits).toBe(commits.fetchCommits);
        expect(fetchDiff).toBe(commits.fetchDiff);
    });

    test("the authenticated header contract retains the original token format", () => {
        expect(getHeaders({ githubToken: "" } as TrackerContext))
            .toEqual({ "User-Agent": "GithubTracker" });
        expect(getHeaders({ githubToken: "secure-token" } as TrackerContext))
            .toEqual({ "User-Agent": "GithubTracker", Authorization: "token secure-token" });
    });

    test("Link parser keeps old permissive parsing and skips unrecognised link parts", () => {
        expect(parseLink({} as TrackerContext, null)).toEqual({});
        expect(parseLink({} as TrackerContext, [
            '<https://api.github.com/page/2>; rel="next"',
            'broken',
            '<https://api.github.com/page/1>; rel="prev"',
        ].join(", "))).toEqual({
            next: "https://api.github.com/page/2",
            prev: "https://api.github.com/page/1",
        });
    });

    test("commit response filtering preserves missing values, author fields and input order", () => {
        const context = {} as TrackerContext;
        expect(normCommItems(context, null)).toEqual([]);
        expect(normCommItems(context, { sha: "abc" })).toEqual([]);
        expect(normCommItems(context, [
            { sha: 123, commit: {} },
            { sha: "abc", commit: { message: "first", author: { name: "Kitty", date: "2026-10-10" } }, html_url: "https://github.com/abc" },
            { sha: "bad", commit: null },
            { sha: "def", commit: { message: null, author: "invalid" } },
            { sha: "ghi", commit: {} },
        ])).toEqual([
            { sha: "abc", html_url: "https://github.com/abc", commit: { message: "first", author: { name: "Kitty", date: "2026-10-10" } } },
            { sha: "def", html_url: undefined, commit: { message: "", author: { name: "", date: "" } } },
            { sha: "ghi", html_url: undefined, commit: { message: "", author: { name: "", date: "" } } },
        ]);
    });

    test("commit detail collection keeps original sequential diff/version enrichment", async () => {
        const calls: string[] = [];
        const items: GitHubCommit[] = [
            { sha: "first", html_url: "https://github.com/first", commit: { message: "Initial", author: { name: "Alice", date: "2026-10-08" } } },
            { sha: "second", commit: { message: "Second" } },
        ];
        const ctx = {
            owner: "kittyCrypto-gg",
            fetchCommItms: async (repo: string, branch: string, since: string, stop: string) => {
                calls.push("fetch:" + [repo, branch, since, stop].join("|"));
                return items;
            },
            fetchDiff: async (_repo: string, sha: string) => {
                calls.push("diff:" + sha);
                return "patch:" + sha;
            },
            tryReadmeMajorAtSha: async (_repo: string, sha: string, fallback: number) => {
                calls.push("major:" + sha + ":" + fallback);
                return sha === "first" ? 7 : fallback;
            }
        } as unknown as TrackerContext;
        const original = console.log;
        const logged: unknown[][] = [];
        console.log = (...args: unknown[]) => logged.push(args);
        let results;
        try {
            results = await fetchCommits(ctx, "server", "main", "2026-10-01T00:00:00Z", { major: 5, readmeSha: "unused" }, "stop-sha");
        } finally {
            console.log = original;
        }
        expect(results).toEqual([
            { sha: "first", author: "Alice", date: "2026-10-08", message: "Initial", url: "https://github.com/first", diff: "patch:first", version: "7.0" },
            { sha: "second", author: "", date: "", message: "Second", url: "", diff: "patch:second", version: "5.0" },
        ]);
        expect(calls).toEqual([
            "fetch:server|main|2026-10-01T00:00:00Z|stop-sha",
            "diff:first", "major:first:5", "diff:second", "major:second:5"
        ]);
        expect(logged.map(x=>x.join(" "))).toEqual(["[GithubTracker][kittyCrypto-gg/server] fetched=2"]);
    });

    test("empty commit pages return before enrichment without a network request", async () => {
        const calls: string[] = [];
        const ctx = {
            owner: "kittyCrypto-gg",
            fetchCommItms: async () => { calls.push("fetch"); return []; },
            fetchDiff: async () => { calls.push("diff"); return ""; },
            tryReadmeMajorAtSha: async () => { calls.push("version"); return 0; }
        } as unknown as TrackerContext;
        const original = console.log;
        console.log = () => undefined;
        try {
            expect(await fetchCommits(ctx, "server", "main", "2026-10-01", {major: 0, readmeSha: ""}, ""))
                .toEqual([]);
        } finally {
            console.log = original;
        }
        expect(calls).toEqual(["fetch"]);
    });
});
