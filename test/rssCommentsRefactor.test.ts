import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OpenAI from "openai";
import { isValidURL, isValidRssComment, safeDecode } from "../src/rssComments/validation";
import { loadModeratorStrings } from "../src/rssComments/stringLoader";
import { moderateComment } from "../src/rssComments/moderation";

const valid = {
    slug: "post", nick: "Kitty", msg: "Hello", ip: "203.0.113.4",
    sessionToken: "token", timestamp: "2026-10-10T00:00:00Z", id: "1234"
};

test("RSS comment validation retains required fields and optional field types", () => {
    expect(isValidRssComment(valid)).toBe(true);
    expect(isValidRssComment({ ...valid, website: "not-a-url", location: "" })).toBe(true);
    expect(isValidRssComment({ ...valid, slug: 5 })).toBe(false);
    expect(isValidRssComment({ ...valid, website: 42 })).toBe(false);
    expect(isValidRssComment({ ...valid, location: null })).toBe(false);
    expect(isValidRssComment(null)).toBe(false);
});

test("URL recognition and percent-decoding retain existing permissive rules", () => {
    expect(isValidURL("https://example.org")).toBe(true);
    expect(isValidURL("ftp://example.org")).toBe(true);
    expect(isValidURL("not-a-url")).toBe(false);
    expect(safeDecode("an%20article")).toBe("an article");
    expect(safeDecode("%ZZ")).toBe("%ZZ");
});

test("moderator JSON preserves a valid map, returns empty for arrays, and throws for invalid files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rss-moderator-"));
    const file = join(dir, "strings.json");
    try {
        await writeFile(file, JSON.stringify({ moderator: { role: "Check for spam." } }));
        expect(loadModeratorStrings(file)).toEqual({ moderator: { role: "Check for spam." } });
        await writeFile(file, "[]");
        expect(loadModeratorStrings(file)).toEqual({});
        await writeFile(file, "{");
        expect(() => loadModeratorStrings(file)).toThrow("Could not load moderator strings.");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("RSS comment moderation preserves exact model, system fallback and original user prompt", async () => {
    let request: unknown;
    const client = {
        chat: { completions: { create: async (args: unknown) => {
            request = args;
            return { choices: [{ message: { content: "approved" } }] };
        } } }
    } as unknown as OpenAI;
    expect(await moderateComment("Hello", { moderator: { role: "Be polite." } }, client)).toBe("approved");
    expect(request).toEqual({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: "Be polite." },
            { role: "user", content: "The user submitted the following RSS post comment:\n\nHello" }
        ]
    });
    expect(await moderateComment("Hello", {}, client)).toBe("approved");
    const messages = (request as { messages: { content: string }[] }).messages;
    expect(messages[0]?.content).toBe("You are a moderator. Please moderate the following message:");
});

test("moderation retains fallback content and error sentinel without exposing provider errors", async () => {
    const noContent = { chat: { completions: { create: async () =>
        ({ choices: [{ message: { content: null } }] }) } } } as unknown as OpenAI;
    expect(await moderateComment("text", {}, noContent)).toBe("Error moderating comment.");
    const rejected = { chat: { completions: { create: async () => {
        throw new Error("provider unavailable");
    } } } } as unknown as OpenAI;
    expect(await moderateComment("text", {}, rejected)).toBe("ERROR");
});
