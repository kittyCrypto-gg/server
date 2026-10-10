import { describe, expect, test } from "bun:test";
import { summariseCommitLog } from "../src/autoBlogger/summariseLog";
import type { BloggerContext } from "../src/autoBlogger/context";
import type { CommitLog } from "../src/autoBlogger/types";

const example = {
    repo: "project", createdAt: "2026-10-10T12:00:00Z", blogged: false,
    commits: [{ sha: "abc", author: "author", date: "2026-10-10T12:00:00Z",
        message: "!fix", url: "https://github.com/abc", diff: "sample", version: "2.1" }]
} as CommitLog;

function fixture(failure: "none" | "single" | "first-chunk" = "none") {
    const actions: string[] = [];
    const chunks = [
        JSON.stringify(example),
        JSON.stringify({ ...example, commits: [] })
    ];
    const ctx = {
        repo: "project",
        buildSummary: () => ({ systemPrompt: "role", userPromptBase: "request" }),
        normalise: (json: CommitLog, max: number) => { actions.push("normalise:" + max); return json; },
        splitJson: (_json: CommitLog, max: number, a: number, b: number) => {
            actions.push("split:" + [max, a, b].join(":")); return chunks;
        },
        summariseChunk: async (_role: string, _user: string, json: string) => {
            if (failure === "single" && json.includes("\n")) {
                actions.push("single-error");
                throw new Error("resulted in 30000 tokens");
            }
            if (failure === "first-chunk" && json.includes("\n")) {
                actions.push("single-error");
                throw new Error("resulted in 30000 tokens");
            }
            if (failure === "first-chunk" && json === chunks[0]) {
                actions.push("chunk-error");
                throw new Error("resulted in 42000 tokens");
            }
            actions.push("summary");
            return "summary-" + (JSON.parse(json) as CommitLog).commits.length;
        },
        toSkinnyLog: (json: CommitLog) => {
            actions.push("skinny");
            return { ...json, commits: json.commits.map(c => ({ ...c, diff: "" })) };
        },
        mergeSumm: async (parts: string[], user: string) => {
            actions.push("merge:" + user); return parts.join("+");
        }
    } as unknown as BloggerContext;
    return { ctx, actions };
}

describe("shared autoBlogger summarisation parity", () => {
    test("single pass has identical output for latest and all variants", async () => {
        const { ctx, actions } = fixture();
        expect(await summariseCommitLog(ctx, example, "Writer")).toBe("summary-1");
        expect(await summariseCommitLog(ctx, example, "Writer", "history.json")).toBe("summary-1");
        expect(actions.filter(x => x.startsWith("split:"))).toEqual([]);
        expect(actions.filter(x => x === "merge:Writer")).toHaveLength(2);
    });

    test("failed single pass falls back to chunks without changing original latest logs", async () => {
        const { ctx, actions } = fixture("first-chunk");
        const originalWarn = console.warn, originalLog = console.log;
        const warning: string[] = [], logging: string[] = [];
        console.warn = (...items: unknown[]) => warning.push(items.join(" "));
        console.log = (...items: unknown[]) => logging.push(items.join(" "));
        let result: string;
        try { result = await summariseCommitLog(ctx, example, "Writer"); }
        finally { console.warn = originalWarn; console.log = originalLog; }
        expect(result).toBe("summary-1+summary-0");
        expect(warning).toEqual([
            "[autoBlogger][project] Single-pass summarise failed, falling back to chunking. tokens=30000",
            "[autoBlogger][project] Chunk 1/2 failed. tokens=42000"
        ]);
        expect(logging).toEqual(["[autoBlogger][project] Splitting into 2 chunk(s)."]);
        expect(actions).toEqual(["normalise:10000","single-error","split:24000:2:4","chunk-error","skinny","summary","summary","merge:Writer"]);
    });

    test("all-commits branch preserves filename-specific chunk logs and merge ordering", async () => {
        const { ctx } = fixture("single");
        const originalWarn = console.warn, originalLog = console.log;
        const warning: string[] = [], logging: string[] = [];
        console.warn = (...items: unknown[]) => warning.push(items.join(" "));
        console.log = (...items: unknown[]) => logging.push(items.join(" "));
        let result: string;
        try { result = await summariseCommitLog(ctx, example, "Writer", "commits.json"); }
        finally { console.warn = originalWarn; console.log = originalLog; }
        expect(result).toBe("summary-1+summary-0");
        expect(warning).toEqual(["[autoBlogger][project] Single-pass summarise failed, falling back to chunking. tokens=30000"]);
        expect(logging).toEqual(["[autoBlogger][project] commits.json split into 2 chunk(s)."]);
    });
});
