import { expect, test } from "bun:test";
import { estimateTokens, truncateDiff } from "../src/textBudget";
import { estimateTokens as bloggerTokens, truncateDiff as bloggerDiff } from "../src/autoBlogger/tokenBudget";
import { estTokens as trackerTokens, truncateDiff as trackerDiff } from "../src/githubTracker/tierClassifier";

test("both historical modules keep the same shared pure function identities", () => {
    expect(bloggerTokens).toBe(estimateTokens);
    expect(trackerTokens).toBe(estimateTokens);
    expect(bloggerDiff).toBe(truncateDiff);
    expect(trackerDiff).toBe(truncateDiff);
});

test("token estimates continue to count UTF-8 bytes, not code units", () => {
    for (const content of ["", "a", "ab", "abc", "abcdef", "🌸", "é", "a\nb\n"]) {
        const expected = Math.ceil(Buffer.byteLength(content, "utf8") / 2);
        expect(bloggerTokens(content)).toBe(expected);
        expect(trackerTokens(content)).toBe(expected);
    }
});

test("diff truncation retains exact marker, fraction, trimming and edge cases", () => {
    for (const [diff, limit] of [
        ["sample", 10], ["abcdefghijklmnopqrstuvwxyz", 8],
        ["    abc def ghi     uvw xyz     ", 10],
        ["", 0], ["1234567890", 0], ["123456", 5]
    ] as const) {
        expect(bloggerDiff(diff, limit)).toBe(trackerDiff(diff, limit));
    }
    expect(truncateDiff("abcdefghijklmnopqrstuvwxyz", 8)).toBe("abc\n\n... [diff truncated for length] ...\n\nwxyz");
    expect(truncateDiff("short", 10)).toBe("short");
});
