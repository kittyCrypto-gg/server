import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenAI } from "openai";
import { autoBlogger } from "../src/autoBlogger";
import type { CommitLog } from "../src/autoBlogger";
import { diffLines, splitMarkdown } from "../src/autoBlogger/markdown";
import { estimateTokens, truncateDiff, normalise, splitJson, extractTknCnt, toSkinnyLog } from "../src/autoBlogger/tokenBudget";
import type { BloggerContext } from "../src/autoBlogger/context";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

const fixtureLog = (options: { blogged?: boolean; message?: string } = {}): CommitLog => ({
  repo: "project",
  createdAt: "2026-10-09T12:00:00Z" as CommitLog["createdAt"],
  blogged: options.blogged ?? false,
  commits: [{
    sha: "abc123",
    author: "Kitty",
    date: "2026-10-09T12:00:00Z" as CommitLog["commits"][number]["date"],
    message: options.message ?? "!fix improve code",
    url: "https://github.com/example/project/commit/abc123",
    diff: "example diff",
    version: "8.2"
  }]
});

function stubOpenAI(content = "A generated summary"): OpenAI {
  return {
    chat: {
      completions: {
        create: async (args: { messages: Array<{ content: string }> }) => ({
          choices: [{
            message: {
              content: args.messages[0]?.content.includes("You convert American English spelling")
                ? JSON.stringify({ patched: args.messages.at(-1)?.content.includes("color") ? content.replace("color", "colour") : content })
                : content
            }
          }]
        })
      }
    }
  } as unknown as OpenAI;
}

async function setup(content = "A generated summary"): Promise<{
  blogger: autoBlogger;
  commitsDir: string;
  postsDir: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "auto-blogger-"));
  roots.push(dir);
  const commitsDir = path.join(dir, "commits");
  const postsDir = path.join(dir, "posts");
  await mkdir(commitsDir);
  await mkdir(postsDir);
  const blogger = new autoBlogger("example", "project", stubOpenAI(content), {});
  const state = blogger as unknown as { commitsDir: string; postsDir: string };
  state.commitsDir = commitsDir;
  state.postsDir = postsDir;
  return { blogger, commitsDir, postsDir };
}

describe("autoBlogger compatibility", () => {
  test("retains the existing class and public methods", () => {
    expect(typeof autoBlogger).toBe("function");
    expect(typeof autoBlogger.prototype.summariseLatest).toBe("function");
    expect(typeof autoBlogger.prototype.summariseAll).toBe("function");
  });

  test("reports per-line differences and rejects changed line counts", () => {
    expect(diffLines("one\ntwo", "one\nthree")).toEqual([{ line: 2, before: "two", after: "three" }]);
    expect(diffLines("one", "one\ntwo")).toEqual([{ line: 0, before: "[line-count=1]", after: "[line-count=2]" }]);
  });

  test("splits Markdown without dividing fenced code blocks", () => {
    const markdown = "heading\n```ts\nconst a = 1;\n```\nfooter";
    const pieces = splitMarkdown({} as BloggerContext, markdown, 16);
    expect(pieces.map(p => p.text).join("\n")).toBe(markdown);
    expect(pieces.filter(p => p.text.includes("```ts"))).toHaveLength(1);
    expect(pieces.find(p => p.text.includes("```ts"))?.text).toContain("const a = 1;");
    expect(pieces[0].startLine).toBe(1);
  });

  test("keeps token estimation, diff truncation and token errors", () => {
    expect(estimateTokens("abcd")).toBe(2);
    expect(truncateDiff("short", 15)).toBe("short");
    expect(truncateDiff("abcdefghijklmnopqrstuvwxyz", 8)).toContain("[diff truncated for length]");
    expect(extractTknCnt({ message: "This resulted in 40200 tokens" })).toBe(40200);
    expect(extractTknCnt({ message: "different error" })).toBeNull();
  });

  test("normalises oversized diffs without mutating original commits", () => {
    const log = fixtureLog();
    const copied = normalise({} as BloggerContext, log, 4);
    expect(copied.commits[0].diff).toContain("[diff truncated for length]");
    expect(log.commits[0].diff).toBe("example diff");
    const skinny = toSkinnyLog({} as BloggerContext, log);
    expect(skinny.commits[0].diff).toBe("");
    expect(skinny.commits[0].sha).toBe(log.commits[0].sha);
  });

  test("splits JSON by token budget without losing commits", () => {
    const log = fixtureLog();
    log.commits = Array.from({ length: 5 }, (_, i) => ({ ...log.commits[0], sha: String(i), diff: "x".repeat(50) }));
    const chunks = splitJson({} as BloggerContext, log, 30, 5, 5);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap(x => (JSON.parse(x) as CommitLog).commits).map(c => c.sha)).toEqual(["0","1","2","3","4"]);
  });

  test("summariseLatest creates its original output and marks history as blogged", async () => {
    const { blogger, commitsDir } = await setup();
    const filename = "20261009-120000-GithubTracker-example-project.json";
    await writeFile(path.join(commitsDir, filename), JSON.stringify(fixtureLog()));
    const outputs = await blogger.summariseLatest("Writer");
    expect(outputs).toHaveLength(1);
    expect(path.basename(outputs[0])).toMatch(/^autoBlogger-commits-\d{8}-\d{2}:\d{2}-Writer-project\.md$/);
    expect(await readFile(outputs[0], "utf8")).toBe("A generated summary");
    expect((JSON.parse(await readFile(path.join(commitsDir, filename), "utf8")) as CommitLog).blogged).toBe(true);
    expect(await blogger.summariseLatest("Writer")).toEqual([]);
  });

  test("summariseAll uses tracker stamps and skips already-blogged histories", async () => {
    const { blogger, commitsDir, postsDir } = await setup();
    const first = "20261009-100000-GithubTracker-example-project.json";
    const second = "20261009-120000-GithubTracker-example-project.json";
    await writeFile(path.join(commitsDir, first), JSON.stringify(fixtureLog({ blogged: true })));
    await writeFile(path.join(commitsDir, second), JSON.stringify(fixtureLog()));
    const outputs = await blogger.summariseAll("Writer");
    expect(outputs.map(x => path.basename(x))).toEqual(["autoBlogger-commits-20261009-120000-Writer-project.md"]);
    expect(await readdir(postsDir)).toHaveLength(1);
    expect((JSON.parse(await readFile(path.join(commitsDir, first), "utf8")) as CommitLog).blogged).toBe(true);
    expect((JSON.parse(await readFile(path.join(commitsDir, second), "utf8")) as CommitLog).blogged).toBe(true);
    expect(await blogger.summariseAll("Writer")).toEqual([]);
  });
});
