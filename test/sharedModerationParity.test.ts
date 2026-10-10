import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { moderateText } from "../src/moderation/moderate";
import { moderateComment } from "../src/rssComments/moderation";
import { moderateMessage } from "../src/kittyChat/moderation";
import Comment from "../src/kittyComment";

const commonRole = "You are a moderator. Please moderate the following message:";
const profile = {
    userPromptPrefix: "The user submitted the following comment:",
    emptyContentFallback: "Error moderating comment.",
    errorLogPrefix: "❌ AI moderation failed:"
};
function fake(content: string | null, onCall: (arg: unknown) => void, failure?: Error): OpenAI {
    return { chat: { completions: { create: async (arg: unknown) => {
        onCall(arg);
        if (failure) throw failure;
        return { choices: [{ message: { content } }] };
    } } } } as unknown as OpenAI;
}

describe("three moderation callers share API behaviour without losing their contract", () => {
    test("the shared comment profile keeps the exact API payload and original class hook", async () => {
        const calls: unknown[] = [];
        expect(await moderateText("hello", { moderator: { role: "Custom" } }, fake("approved", x=>calls.push(x)), profile)).toBe("approved");
        expect(calls).toEqual([{ model: "gpt-4o-mini", messages: [
            { role: "system", content: "Custom" },
            { role: "user", content: "The user submitted the following comment:\n\nhello" }
        ] }]);
        expect(typeof (Comment.prototype as unknown as Record<string, unknown>).moderateComment).toBe("function");
    });

    test("RSS and chat retain separate user prompts and default system role", async () => {
        const calls: unknown[] = [];
        expect(await moderateComment("rss", {}, fake("OK1", x=>calls.push(x)))).toBe("OK1");
        expect(await moderateMessage("chat", {}, fake("OK2", x=>calls.push(x)))).toBe("OK2");
        expect(calls).toEqual([
            { model: "gpt-4o-mini", messages: [
                { role: "system", content: commonRole },
                { role: "user", content: "The user submitted the following RSS post comment:\n\nrss" }
            ] },
            { model: "gpt-4o-mini", messages: [
                { role: "system", content: commonRole },
                { role: "user", content: "The user has requested to store the following:\n\nchat" }
            ] }
        ]);
    });

    test("null content and API exceptions retain each caller's unique fallbacks", async () => {
        const noop = () => {};
        expect(await moderateText("x", {}, fake(null, noop), profile)).toBe("Error moderating comment.");
        expect(await moderateComment("x", {}, fake(null, noop))).toBe("Error moderating comment.");
        expect(await moderateMessage("x", {}, fake(null, noop))).toBe("Error moderating the message.");
        const errors: string[] = [], original = console.error;
        console.error = (prefix: unknown) => { errors.push(String(prefix)); };
        try {
            const rejected = fake(null, noop, new Error("unavailable"));
            expect(await moderateText("x", {}, rejected, profile)).toBe("ERROR");
            expect(await moderateComment("x", {}, rejected)).toBe("ERROR");
            expect(await moderateMessage("x", {}, rejected)).toBe("ERROR");
        } finally {
            console.error = original;
        }
        expect(errors).toEqual([
            "❌ AI moderation failed:", "❌ RSS comment AI moderation failed:",
            "❌ ERROR: AI moderation failed:"
        ]);
    });
});
