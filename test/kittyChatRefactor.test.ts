import { expect, test } from "bun:test";
import crypto from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptValue, encryptValue, generateMsgId, generateUserId } from "../src/kittyChat/crypto";
import { loadModeratorStrings } from "../src/kittyChat/moderatorStrings";
import { moderateMessage } from "../src/kittyChat/moderation";
import type { OpenAI } from "openai";

const key = Buffer.alloc(32, 0x43);

test("AES-256-GCM messages preserve the existing v2 wire format and decrypt", () => {
    const encrypted = encryptValue("hello 💙", key);
    expect(encrypted).toMatch(/^v2:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(decryptValue(encrypted, key)).toBe("hello 💙");
    expect(encryptValue("hello 💙", key)).not.toBe(encrypted);
});

test("legacy AES-256-CBC messages still decrypt without migration", () => {
    const iv = Buffer.alloc(16, 0x07);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const value = Buffer.concat([cipher.update("legacy message", "utf8"), cipher.final()]);
    expect(decryptValue(`${iv.toString("hex")}:${value.toString("hex")}`, key)).toBe("legacy message");
});

test("the historical CHAT_KEY length validation remains intact", () => {
    expect(() => encryptValue("test", Buffer.alloc(12))).toThrow("CHAT_KEY must be exactly 32 bytes, but got 12 bytes.");
});

test("message and user IDs keep their hash and divisibility rules", () => {
    const expected = crypto.createHash("sha256").update("203.0.113.7").digest("hex").substring(0, 10);
    expect(generateUserId("203.0.113.7")).toBe(`0x${expected}`);
    const id = generateMsgId("abc", "2026-10-10T00:00:00.000Z", "0a");
    expect(BigInt(id) % BigInt("0x0a")).toBe(0n);
});

test("moderator strings read as the existing JSON map", () => {
    const folder = mkdtempSync(join(tmpdir(), "chat-refactor-"));
    try {
        const file = join(folder, "strings.json");
        writeFileSync(file, JSON.stringify({ moderator: { role: "Check for spam." } }));
        expect(loadModeratorStrings(file)).toEqual({ moderator: { role: "Check for spam." } });
        writeFileSync(file, JSON.stringify([1, 2]));
        expect(loadModeratorStrings(file)).toEqual({});
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("AI moderation preserves the prompt, selected model and returned text", async () => {
    let captured: unknown;
    const client = {
        chat: {
            completions: {
                create: async (args: unknown) => {
                    captured = args;
                    return { choices: [{ message: { content: "approved" } }] };
                }
            }
        }
    } as unknown as OpenAI;
    const result = await moderateMessage("hello", { moderator: { role: "Moderator policy" } }, client);
    expect(result).toBe("approved");
    expect(captured).toEqual({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: "Moderator policy" },
            { role: "user", content: "The user has requested to store the following:\n\nhello" }
        ]
    });
});
