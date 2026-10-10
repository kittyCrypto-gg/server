import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import type Server from "../src/baseServer";
import type { tokenStore } from "../src/tokenStore";
import type { ChatMessage } from "../src/kittyChat/types";

// Import after setting dummy credentials: the historical Chat module constructs
// its OpenAI client and reads CHAT_KEY when the module is evaluated.
const previousOpenAiKey = process.env.OPENAI_KEY;
const previousChatKey = process.env.CHAT_KEY;
process.env.OPENAI_KEY = "chat-mutation-parity-test";
process.env.CHAT_KEY = Buffer.alloc(32, 0x43).toString("base64");
const { default: Chat } = await import("../src/kittyChat");
const { encryptChatMessage } = await import("../src/kittyChat/crypto");

afterAll(() => {
    if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_KEY;
    } else {
        process.env.OPENAI_KEY = previousOpenAiKey;
    }

    if (previousChatKey === undefined) {
        delete process.env.CHAT_KEY;
    } else {
        process.env.CHAT_KEY = previousChatKey;
    }
});

type Handler = (req: Request, res: Response) => Promise<unknown>;
type ResponseResult = { status: number; body: unknown };
const initialMessages: ChatMessage[] = [
    {
        nick: "Alice", id: "user-a", msg: "Original A",
        timestamp: "2026-10-10T08:00:00.000Z", msgId: "120"
    },
    {
        nick: "Bob", id: "user-b", msg: "Original B",
        timestamp: "2026-10-10T08:01:00.000Z", msgId: "210"
    }
];

async function createHarness() {
    const folder = await mkdtemp(join(tmpdir(), "chat-mutations-"));
    const file = join(folder, "chat.json");
    await writeFile(file, JSON.stringify(initialMessages.map(encryptChatMessage)), "utf8");

    const handlers = new Map<string, Handler>();
    const server = {
        app: {
            post: (route: string, handler: Handler) => { handlers.set(route, handler); }
        }
    } as unknown as Server;
    const chat = new Chat(server, file, null as unknown as tokenStore);

    const invoke = async (route: string, body: Record<string, unknown>): Promise<ResponseResult> => {
        const handler = handlers.get(route);
        if (!handler) {
            throw new Error("Chat route not registered: " + route);
        }

        const response = {
            headersSent: false,
            statusCode: 200,
            body: undefined as unknown,
            status(code: number) { this.statusCode = code; return this; },
            json(value: unknown) { this.body = value; this.headersSent = true; return this; },
            send(value: unknown) { this.body = value; this.headersSent = true; return this; }
        };

        await handler({ body } as Request, response as unknown as Response);
        return { status: response.statusCode, body: response.body };
    };

    return { folder, file, chat, invoke };
}

async function withHarness(
    run: (ctx: Awaited<ReturnType<typeof createHarness>>) => Promise<void>
): Promise<void> {
    const ctx = await createHarness();
    try {
        await run(ctx);
    } finally {
        await rm(ctx.folder, { recursive: true, force: true });
    }
}

const edit = (sessionToken: string, msgId = "120", newMessage = "Edited A") => ({
    msgId, sessionToken, ip: "203.0.113.7", newMessage
});
const remove = (sessionToken: string, msgId = "120") => ({
    msgId, sessionToken, ip: "203.0.113.7"
});

test("registered edit/delete routes retain encrypted persistence, ordering and cache updates", async () => {
    await withHarness(async ({ chat, file, invoke }) => {
        expect(chat.readyMessage()).toBe("💬 Chat is ready.");
        expect(await chat.loadAndDecryptChat()).toEqual(initialMessages);

        expect(await invoke("/chat/edit", edit("0a"))).toEqual({
            status: 200, body: { success: true }
        });
        const afterEdit = await chat.loadAndDecryptChat();
        expect(afterEdit).toEqual([
            { ...initialMessages[0], msg: "Edited A", edited: true },
            initialMessages[1]
        ]);

        const encrypted = JSON.parse(await readFile(file, "utf8")) as ChatMessage[];
        expect(encrypted[0]?.msg).toMatch(/^v2:/);
        expect(encrypted[0]?.msg).not.toContain("Edited A");

        expect(await invoke("/chat/delete", remove("0a"))).toEqual({
            status: 200, body: { success: true }
        });
        expect(await chat.loadAndDecryptChat()).toEqual([initialMessages[1]]);
        expect(JSON.parse(await readFile(file, "utf8"))).toHaveLength(1);
    });
});

test("incorrect divisors return 403 without changing stored ciphertext", async () => {
    await withHarness(async ({ invoke, file, chat }) => {
        const original = await readFile(file, "utf8");
        expect(await invoke("/chat/edit", edit("07"))).toEqual({
            status: 403, body: { error: "Unauthorised" }
        });
        expect(await invoke("/chat/delete", remove("07"))).toEqual({
            status: 403, body: { error: "Unauthorised" }
        });
        expect(await readFile(file, "utf8")).toBe(original);
        expect(await chat.loadAndDecryptChat()).toEqual(initialMessages);
    });
});

test("missing message IDs and invalid requests retain historical responses", async () => {
    await withHarness(async ({ invoke, file }) => {
        const original = await readFile(file, "utf8");
        expect(await invoke("/chat/edit", edit("0a", "999"))).toEqual({
            status: 200, body: { error: "Message not found" }
        });
        expect(await invoke("/chat/delete", remove("0a", "999"))).toEqual({
            status: 200, body: { error: "Message not found" }
        });
        expect(await invoke("/chat/edit", edit("0a", "120", "   "))).toEqual({
            status: 200, body: { error: "Missing required parameters" }
        });
        expect(await invoke("/chat/delete", { msgId: "120", sessionToken: "0a" })).toEqual({
            status: 200, body: { error: "Missing required parameters" }
        });
        expect(await readFile(file, "utf8")).toBe(original);
    });
});

test("zero and malformed divisors remain internal errors, never authorisation bypasses", async () => {
    await withHarness(async ({ invoke, file }) => {
        const original = await readFile(file, "utf8");
        for (const token of ["0", "not-hex"]) {
            expect(await invoke("/chat/edit", edit(token))).toEqual({
                status: 200, body: { error: "Internal Server Error" }
            });
            expect(await invoke("/chat/delete", remove(token))).toEqual({
                status: 200, body: { error: "Internal Server Error" }
            });
        }
        expect(await readFile(file, "utf8")).toBe(original);
    });
});

test("separate chat instances serialise edits to distinct messages in one store", async () => {
    await withHarness(async ({ file, invoke }) => {
        const routes = new Map<string, Handler>();
        const server = {
            app: { post: (route: string, handler: Handler) => { routes.set(route, handler); } }
        } as unknown as Server;
        const second = new Chat(server, file, null as unknown as tokenStore);
        // Both instances have separate MutexJsonStore objects pointing at the same file.
        const firstEdit = invoke("/chat/edit", edit("0a"));
        const secondEdit = (async () => {
            const response = {
                headersSent: false, statusCode: 200, body: undefined as unknown,
                status(code: number) { this.statusCode = code; return this; },
                json(value: unknown) { this.body = value; this.headersSent = true; return this; },
                send(value: unknown) { this.body = value; this.headersSent = true; return this; }
            };
            await routes.get("/chat/edit")!({
                body: edit("0a", "210", "Edited B")
            } as Request, response as unknown as Response);
            return { status: response.statusCode, body: response.body };
        })();

        expect(await Promise.all([firstEdit, secondEdit])).toEqual([
            { status: 200, body: { success: true } },
            { status: 200, body: { success: true } }
        ]);
        expect(await second.loadAndDecryptChat()).toEqual([
            { ...initialMessages[0], msg: "Edited A", edited: true },
            { ...initialMessages[1], msg: "Edited B", edited: true }
        ]);
    });
});
