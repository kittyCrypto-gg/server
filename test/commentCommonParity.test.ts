import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAI } from "openai";
import Comment from "../src/kittyComment";
import RssComment from "../src/rssComments";
import { isValidURL, loadModeratorStrings, moderateSubmittedComment } from "../src/comments/shared";
import { isValidURL as rssURL } from "../src/rssComments/validation";
import { loadModeratorStrings as rssLoader } from "../src/rssComments/stringLoader";
import { moderateComment as rssModerate } from "../src/rssComments/moderation";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(p => rm(p, { recursive:true, force:true })));
});
async function temporary() {
    const dir = await mkdtemp(join(tmpdir(), "comment-parity-"));
    roots.push(dir);
    return join(dir, "moderators.json");
}

describe("cross-module comment parity", () => {
    test("both original helpers forward to identical validators and loaders", () => {
        expect(rssURL).toBe(isValidURL);
        expect(rssLoader).toBe(loadModeratorStrings);
        expect(isValidURL("https://example.com/page")).toBe(true);
        expect(isValidURL("ftp://example.com/page")).toBe(true);
        expect(isValidURL("invalid url")).toBe(false);
        expect(typeof Comment).toBe("function");
        expect(typeof RssComment).toBe("function");
        for (const C of [Comment, RssComment]) {
            expect(typeof C.prototype["moderateComment"]).toBe("function");
            expect(typeof C.prototype["loadModeratorStrings"]).toBe("function");
            expect(typeof C.prototype["readyMessage"]).toBe("function");
        }
    });

    test("reader keeps historical empty-object and malformed/missing-file behaviour", async () => {
        const file = await temporary();
        await writeFile(file, '{"moderator":{"role":"Review carefully"}}');
        expect(loadModeratorStrings(file)).toEqual({moderator:{role:"Review carefully"}});
        await writeFile(file, '[]');
        expect(loadModeratorStrings(file)).toEqual({});
        await writeFile(file, 'null');
        expect(loadModeratorStrings(file)).toEqual({});
        await writeFile(file, '{broken');
        expect(()=>loadModeratorStrings(file)).toThrow("Could not load moderator strings.");
        expect(()=>rssLoader(file+"-missing")).toThrow("Could not load moderator strings.");
    });

    test("both variants preserve their exact OpenAI model, prompt and empty-content fallback", async () => {
        const calls: unknown[] = [];
        const client = { chat:{ completions:{create:async (args:unknown)=>{
            calls.push(args); return {choices:[{message:{content:null}}]};
        }}}} as unknown as OpenAI;
        expect(await moderateSubmittedComment("Hello", {}, client, "comment", "ignored")).toBe("Error moderating comment.");
        expect(await rssModerate("Hello", {moderator:{role:"custom role"}}, client)).toBe("Error moderating comment.");
        expect(calls).toEqual([
            {model:"gpt-4o-mini",messages:[
                {role:"system",content:"You are a moderator. Please moderate the following message:"},
                {role:"user",content:"The user submitted the following comment:\n\nHello"}
            ]},
            {model:"gpt-4o-mini",messages:[
                {role:"system",content:"custom role"},
                {role:"user",content:"The user submitted the following RSS post comment:\n\nHello"}
            ]}
        ]);
    });

    test("RSS and normal comment failures preserve distinct log messages and ERROR sentinel", async () => {
        const failure = new Error("unavailable");
        const client = {chat:{completions:{create:async()=>{throw failure;}}}} as unknown as OpenAI;
        const logs: unknown[][] = [];
        const original = console.error;
        console.error = (...args:unknown[])=>logs.push(args);
        let normal: string, rss: string;
        try {
            normal = await moderateSubmittedComment("Hello", {}, client, "comment", "❌ AI moderation failed:");
            rss = await rssModerate("Hello", {}, client);
        } finally {console.error = original;}
        expect(normal).toBe("ERROR");
        expect(rss).toBe("ERROR");
        expect(logs).toEqual([
            ["❌ AI moderation failed:", failure],
            ["❌ RSS comment AI moderation failed:", failure]
        ]);
    });
});
