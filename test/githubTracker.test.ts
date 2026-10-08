import { describe, expect, test } from "bun:test";
import { GirhubTracker } from "../src/githubTracker";
import {
  parseVer, formatVer, bumpVer, parseSetverDirective, tierFromMsg, setverToReadmeMajor
} from "../src/githubTracker/versioning";
import { parseTJson, estTokens, truncateDiff, genTier } from "../src/githubTracker/tierClassifier";
import { getHeaders, parseLink, normCommItems } from "../src/githubTracker/githubApi";
import type { TrackerContext } from "../src/githubTracker/context";

describe("GitHub tracker compatibility", () => {
  test("retains the exported class and public entry points", () => {
    expect(typeof GirhubTracker).toBe("function");
    expect(typeof GirhubTracker.prototype.getCommits).toBe("function");
    expect(typeof GirhubTracker.prototype.rebuildAll).toBe("function");
  });

  test("parses versions with exactly the existing precision rules", () => {
    expect(parseVer("8.2")).toEqual({ major: 8, digits: [2, 0, 0, 0, 0], precision: 1 });
    expect(parseVer("8.20991")).toEqual({ major: 8, digits: [2, 0, 9, 9, 1], precision: 5 });
    expect(formatVer(parseVer("9"))).toBe("9.0");
    expect(formatVer(parseVer("nonsense"))).toBe("0.0");
  });

  test("major is the integer bump and resets decimal digits", () => {
    expect(formatVer(bumpVer(parseVer("8.20991"), "major"))).toBe("9.0");
  });

  test("refactor increments the first decimal digit and floors trailing digits", () => {
    expect(formatVer(bumpVer(parseVer("8.20991"), "refactor"))).toBe("8.3");
    expect(formatVer(bumpVer(parseVer("8.99999"), "refactor"))).toBe("9.0");
  });

  test("feature bumps do not carry and preserve trailing digits", () => {
    expect(formatVer(bumpVer(parseVer("8.20991"), "feat"))).toBe("8.21991");
    expect(formatVer(bumpVer(parseVer("8.29999"), "feat"))).toBe("8.29999");
  });

  test("minor, fix and tiny target the original precision slots", () => {
    expect(formatVer(bumpVer(parseVer("8.20991"), "minor"))).toBe("8.210");
    expect(formatVer(bumpVer(parseVer("8.20991"), "fix"))).toBe("8.2100");
    expect(formatVer(bumpVer(parseVer("8.20891"), "tiny"))).toBe("8.20892");
  });

  test("skip never changes a version", () => {
    expect(bumpVer(parseVer("8.20991"), "skip")).toEqual(parseVer("8.20991"));
  });

  test("preserves !setver forms and no-argument handling", () => {
    expect(parseSetverDirective("!setver")).toEqual({ kind: "readmeMajor" });
    expect(parseSetverDirective("!setver !fix")).toEqual({ kind: "readmeMajor" });
    expect(parseSetverDirective("!setver=8.204")).toEqual({ kind: "explicit", rawVersion: "8.204" });
    expect(parseSetverDirective("!setver:8.2")).toEqual({ kind: "explicit", rawVersion: "8.2" });
    expect(formatVer(setverToReadmeMajor(8))).toBe("8.0");
  });

  test("preserves the tag priority and fallback", () => {
    expect(tierFromMsg("!skip !major")).toBe("skip");
    expect(tierFromMsg("!refactor !fix")).toBe("refactor");
    expect(tierFromMsg("!perf rendering")).toBe("refactor");
    expect(tierFromMsg("!feat new page")).toBe("feat");
    expect(tierFromMsg("!security fix")).toBe("fix");
    expect(tierFromMsg("!docs update")).toBe("tiny");
    expect(tierFromMsg("ordinary commit")).toBeNull();
  });

  test("preserves JSON classification parsing and confidence bounds", () => {
    expect(parseTJson('{"tier":"fix","confidence":3}')).toEqual({ tier: "fix", confidence: 1 });
    expect(parseTJson('{"tier":"tiny","confidence":-2}')).toEqual({ tier: "tiny", confidence: 0 });
    expect(parseTJson("not json")).toBeNull();
    expect(parseTJson('{"tier":"skip"}')).toBeNull();
  });

  test("uses tiny when no OpenAI client was configured", async () => {
    expect(await genTier({ openai: null } as TrackerContext, "unlabelled", "diff")).toBe("tiny");
  });

  test("retains the tokenizer estimate and difference truncation marker", () => {
    expect(estTokens("abcd")).toBe(2);
    expect(truncateDiff("short", 10)).toBe("short");
    expect(truncateDiff("abcdefghijklmnop", 10)).toContain("[diff truncated for length]");
  });

  test("retains pagination link extraction", () => {
    expect(parseLink({} as TrackerContext, '<https://api.github.com/?page=2>; rel="next", <https://api.github.com/?page=1>; rel="prev"'))
      .toEqual({ next: "https://api.github.com/?page=2", prev: "https://api.github.com/?page=1" });
  });

  test("retains GitHub response filtering", () => {
    const rows = normCommItems({} as TrackerContext, [
      { sha: "abc", commit: { message: "!fix", author: { name: "kitty", date: "2026-10-08" } } },
      { bogus: true }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].commit.author?.name).toBe("kitty");
    expect(normCommItems({} as TrackerContext, null)).toEqual([]);
  });

  test("retains authenticated GitHub header semantics", () => {
    expect(getHeaders({ githubToken: undefined } as TrackerContext)).toEqual({ "User-Agent": "GithubTracker" });
    expect(getHeaders({ githubToken: "example-token" } as TrackerContext)).toEqual({
      "User-Agent": "GithubTracker",
      Authorization: "token example-token"
    });
  });
});
