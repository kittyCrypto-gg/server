import type { Request, Response } from "express";
import type { tokenStore } from "../tokenStore";
import type Chat from "../kittyChat";
import type * as types from "../types";
import fs from "fs";

type NodeErrorWithCode = Error & { code?: string };

export interface OpenChatStreamOptions {
    req: Request;
    res: Response;
    token: string;
    tokenStore: tokenStore;
    chat: Chat;
    clients: types.SseClient[];
    hasKey: boolean;
    heartbeatMS?: number;
    retryMS?: number;
}

export function isSseResponseWritable(res: Response): boolean {
    if (res.writableEnded) return false;
    if (res.destroyed) return false;
    if (res.socket?.destroyed) return false;
    return true;
}

export function writeSseJson(res: Response, payload: unknown): void {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function writeSseComment(res: Response, comment: string): void {
    res.write(`: ${comment}\n\n`);
}

export function removeSseClient(clients: types.SseClient[], res: Response): void {
    const index = clients.findIndex((client) => client.res === res);

    if (index !== -1) {
        clients.splice(index, 1);
    }
}

export async function openChatStream(options: OpenChatStreamOptions): Promise<void> {
    const {
        req,
        res,
        token,
        tokenStore,
        chat,
        clients,
        hasKey,
        heartbeatMS = 15_000,
        retryMS = 5_000
    } = options;

    tokenStore.touchToken(token);
    req.socket.setKeepAlive(true, heartbeatMS);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(`retry: ${retryMS}\n\n`);
    writeSseComment(res, "connected");

    const initialPayload = hasKey
        ? await chat.loadAndDecryptChat()
        : await chat.loadEncryptedChat();

    writeSseJson(res, initialPayload);

    clients.push({ res, hasKey });

    const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
        if (!isSseResponseWritable(res) || req.destroyed) {
            return;
        }

        tokenStore.touchToken(token);
        writeSseComment(res, `keepalive ${Date.now()}`);
    }, heartbeatMS);

    const cleanup = (): void => {
        clearInterval(heartbeat);
        removeSseClient(clients, res);
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("close", cleanup);
    res.on("finish", cleanup);
}

export async function notifyClients(chat: Chat, clients: types.SseClient[]): Promise<void> {
    const [decrypted, encrypted] = await Promise.all([
        chat.loadAndDecryptChat(),
        chat.loadEncryptedChat()
    ]);

    const staleResponses: Response[] = [];

    for (const client of clients) {
        if (!isSseResponseWritable(client.res)) {
            staleResponses.push(client.res);
            continue;
        }

        const payload = client.hasKey ? decrypted : encrypted;

        try {
            writeSseJson(client.res, payload);
        } catch {
            staleResponses.push(client.res);
        }
    }

    for (const res of staleResponses) {
        removeSseClient(clients, res);
    }
}

async function readFileOrEmpty(filePath: string): Promise<string> {
    try {
        return await fs.promises.readFile(filePath, "utf-8");
    } catch (error: unknown) {
        const code = (error as NodeErrorWithCode).code;

        if (code === "ENOENT") {
            return "";
        }

        throw error;
    }
}

export async function trackChatChanges(chat_json_path: string, chat: Chat, clients: types.SseClient[]): Promise<void> {
    let lastChatData = await readFileOrEmpty(chat_json_path);
    let busy = false;

    console.log(`📔 Tracking chat changes in ${chat_json_path}`);

    setInterval(() => {
        if (busy) {
            return;
        }

        busy = true;

        void (async () => {
            try {
                const newChatData = await readFileOrEmpty(chat_json_path);

                if (newChatData !== lastChatData) {
                    chat.clearMessageCache();
                    lastChatData = newChatData;
                    console.log("🔄 Chat data updated. Notifying clients...");
                    await notifyClients(chat, clients);
                }
            } catch (error) {
                console.error("❌ Error tracking chat changes:", error);
            } finally {
                busy = false;
            }
        })();
    }, 1000);
}
