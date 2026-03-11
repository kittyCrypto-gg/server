import crypto from "crypto";
import fs from "fs";
import { Request, Response } from "express";
import { OpenAI } from "openai";
import Server from "./baseServer";
import KittyRequest from "./kittyRequest";
import { tokenStore } from "./tokenStore";
import path from "path";
/* @ts-ignore */
import "dotenv/config";

const CHAT_KEY_RAW = process.env.CHAT_KEY || "";
const CHAT_KEY_BUFFER = Buffer.from(CHAT_KEY_RAW, "base64");
const CHAT_KEY = CHAT_KEY_BUFFER.subarray(0, 32);

const apiKey = process.env.OPENAI_KEY || "";
const openai = new OpenAI({ apiKey });

interface ChatRequest {
    nick: string;
    msg: string;
    ip: string;
    sessionToken: string;
}

interface ChatMessage {
    nick: string;
    id: string;
    msg: string;
    timestamp: string;
    msgId: string;
    edited?: boolean;
}

interface ModeratorStrings {
    role?: string;
    user?: string;
}

class Chat extends KittyRequest<ChatMessage> {
    protected readonly stringsFilePath: string;
    private strings: { [key: string]: ModeratorStrings };
    private messageCache: ChatMessage[] | null = null;
    private ready: boolean = false;

    public constructor(server: Server, jsonFilePath: string, TokenStore: tokenStore) {
        super(server, jsonFilePath, TokenStore, Chat.isValidChatMessage);

        this.stringsFilePath = path.resolve(process.cwd(), "data", "strings.json");
        this.strings = this.loadModeratorStrings();

        try {
            this.server.app.post("/chat", async (req: Request, res: Response) => {
                await this.handleRequest(req, res, () => this.storeMessage(req, res));
            });

            this.server.app.post("/chat/edit", async (req: Request, res: Response) => {
                await this.handleRequest(req, res, () => this.editMessage(req, res));
            });

            this.server.app.post("/chat/delete", async (req: Request, res: Response) => {
                await this.handleRequest(req, res, () => this.deleteMessage(req, res));
            });

            this.ready = true;
        } catch (error) {
            console.error("❌ Failed to register chat endpoints:", error);
            this.ready = false;
            return;
        }
    }

    private loadModeratorStrings(): { [key: string]: ModeratorStrings } {
        try {
            const raw = fs.readFileSync(this.stringsFilePath, "utf-8");
            const parsed = JSON.parse(raw) as unknown;

            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return {};
            }

            return parsed as { [key: string]: ModeratorStrings };
        } catch (error) {
            console.error("❌ Failed to load moderator strings:", error);
            return {};
        }
    }

    private async editMessage(req: Request, res: Response): Promise<object> {
        this.clearMessageCache();

        const { msgId, sessionToken, ip, newMessage } = req.body;

        if (
            typeof msgId !== "string" ||
            typeof sessionToken !== "string" ||
            typeof ip !== "string" ||
            typeof newMessage !== "string" ||
            newMessage.trim().length === 0
        ) {
            return { error: "Missing required parameters" };
        }

        try {
            let found = false;
            let unauthorised = false;
            let updatedMessages: ChatMessage[] | null = null;

            await this.updateFileData(async (currentEncrypted: ChatMessage[]): Promise<ChatMessage[]> => {
                const messages = this.processChatMessages(currentEncrypted, false);
                const index = messages.findIndex((message) => message.msgId === msgId);

                if (index === -1) {
                    return currentEncrypted;
                }

                found = true;

                const msgIdBint = BigInt(msgId);
                const sessionBint = BigInt(`0x${sessionToken}`);

                if (msgIdBint % sessionBint !== BigInt(0)) {
                    unauthorised = true;
                    return currentEncrypted;
                }

                console.log(`✏️ Editing message ${msgId}`);

                const nextMessages = [...messages];
                nextMessages[index] = {
                    ...nextMessages[index],
                    msg: newMessage,
                    edited: true,
                };

                updatedMessages = nextMessages;
                return this.processChatMessages(nextMessages, true);
            });

            if (!found) {
                return { error: "Message not found" };
            }

            if (unauthorised) {
                return res.status(403).send({ error: "Unauthorised" });
            }

            this.messageCache = updatedMessages;
            return { success: true };
        } catch (error) {
            console.error("❌ Error processing edit request:", error);
            return { error: "Internal Server Error" };
        }
    }

    private async deleteMessage(req: Request, res: Response): Promise<object> {
        this.clearMessageCache();

        const { msgId, sessionToken, ip } = req.body;

        if (
            typeof msgId !== "string" ||
            typeof sessionToken !== "string" ||
            typeof ip !== "string"
        ) {
            return { error: "Missing required parameters" };
        }

        try {
            let found = false;
            let unauthorised = false;
            let updatedMessages: ChatMessage[] | null = null;

            await this.updateFileData(async (currentEncrypted: ChatMessage[]): Promise<ChatMessage[]> => {
                const messages = this.processChatMessages(currentEncrypted, false);
                const index = messages.findIndex((message) => message.msgId === msgId);

                if (index === -1) {
                    return currentEncrypted;
                }

                found = true;

                const msgIdBint = BigInt(msgId);
                const sessionBint = BigInt(`0x${sessionToken}`);

                if (msgIdBint % sessionBint !== BigInt(0)) {
                    unauthorised = true;
                    return currentEncrypted;
                }

                console.log(`🗑️ Deleting message ${msgId}`);

                const nextMessages = messages.filter((_, messageIndex) => messageIndex !== index);
                updatedMessages = nextMessages;
                return this.processChatMessages(nextMessages, true);
            });

            if (!found) {
                return { error: "Message not found" };
            }

            if (unauthorised) {
                return res.status(403).send({ error: "Unauthorised" });
            }

            this.messageCache = updatedMessages;
            return { success: true };
        } catch (error) {
            console.error("❌ Error processing delete request:", error);
            return { error: "Internal Server Error" };
        }
    }

    private async moderateMessage(userMessage: string): Promise<string> {
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content:
                            this.strings.moderator?.role ||
                            "You are a moderator. Please moderate the following message:",
                    },
                    { role: "user", content: `The user has requested to store the following:\n\n${userMessage}` },
                ],
            });

            return response.choices[0].message.content ?? "Error moderating the message.";
        } catch (error) {
            console.error("❌ ERROR: AI moderation failed:", error);
            return "ERROR";
        }
    }

    protected async storeMessage(req: Request, res: Response): Promise<object> {
        const body = req.body;
        const requestData = body.chatRequest;

        if (!Chat.isValidChatRequest(requestData)) {
            return { error: "Invalid chat request structure." };
        }

        const { nick, msg, ip, sessionToken } = requestData;
        const userId = this.generateUserId(ip);
        const safeMsg = await this.moderateMessage(msg);
        const timestamp = new Date().toISOString();

        const newMessage: ChatMessage = {
            nick,
            id: userId,
            msg: safeMsg,
            timestamp,
            msgId: this.generateMsgId(userId, timestamp, sessionToken),
        };

        await this.appendEncryptedMessage(newMessage);
        return { success: true, nick, id: userId, msg: safeMsg, msgId: newMessage.msgId };
    }

    private generateMsgId(id: string, timestamp: string, sessionToken: string): string {
        const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
        const salt = crypto.randomBytes(8).toString("hex");
        const hash = crypto
            .createHash("sha256")
            .update(`${id}${unixTimestamp}${sessionToken}${salt}`)
            .digest("hex");
        const numericHash = BigInt(`0x${hash.substring(0, 16)}`);
        const session = BigInt(`0x${sessionToken}`);
        return (numericHash * session).toString();
    }

    public generateUserId(ip: string): string {
        const hash = crypto.createHash("sha256").update(ip).digest("hex").substring(0, 10);
        return `0x${hash}`;
    }

    private encryptValue(value: string): string {
        if (!CHAT_KEY) {
            throw new Error("CHAT_KEY is missing. Ensure it is properly set.");
        }

        if (CHAT_KEY.length !== 32) {
            throw new Error(`CHAT_KEY must be exactly 32 bytes, but got ${CHAT_KEY.length} bytes.`);
        }

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", CHAT_KEY, iv);

        const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag();

        return `v2:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
    }

    private decryptValue(encryptedValue: string): string {
        try {
            if (!CHAT_KEY) {
                throw new Error("CHAT_KEY is missing. Ensure it is properly set.");
            }

            if (CHAT_KEY.length !== 32) {
                throw new Error(`CHAT_KEY must be exactly 32 bytes, but got ${CHAT_KEY.length} bytes.`);
            }

            const parts = encryptedValue.split(":");

            if (parts.length === 4 && parts[0] === "v2") {
                const iv = Buffer.from(parts[1], "hex");
                const tag = Buffer.from(parts[2], "hex");
                const encryptedText = Buffer.from(parts[3], "hex");

                const decipher = crypto.createDecipheriv("aes-256-gcm", CHAT_KEY, iv);
                decipher.setAuthTag(tag);

                const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
                return decrypted.toString("utf8");
            }

            if (parts.length === 2) {
                const iv = Buffer.from(parts[0], "hex");
                const encryptedText = Buffer.from(parts[1], "hex");

                const decipher = crypto.createDecipheriv("aes-256-cbc", CHAT_KEY, iv);
                const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
                return decrypted.toString("utf8");
            }

            throw new Error("Unknown encrypted format");
        } catch (error) {
            console.error("❌ ERROR: Decryption failed!", error);
            return "ERROR";
        }
    }

    private encryptChatMessage(message: ChatMessage): ChatMessage {
        return {
            nick: this.encryptValue(message.nick),
            id: this.encryptValue(message.id),
            msg: this.encryptValue(message.msg),
            msgId: message.msgId,
            timestamp: message.timestamp,
            ...(message.edited ? { edited: true } : {}),
        };
    }

    private decryptChatMessage(message: ChatMessage): ChatMessage {
        return {
            nick: this.decryptValue(message.nick),
            id: this.decryptValue(message.id),
            msg: this.decryptValue(message.msg),
            msgId: message.msgId,
            timestamp: message.timestamp,
            ...(message.edited ? { edited: true } : {}),
        };
    }

    public processChatMessages(messages: ChatMessage[], encrypt: boolean): ChatMessage[] {
        return messages.map((message) => {
            return encrypt ? this.encryptChatMessage(message) : this.decryptChatMessage(message);
        });
    }

    public async loadAndDecryptChat(): Promise<ChatMessage[]> {
        if (this.messageCache) {
            return this.messageCache;
        }

        try {
            const encryptedData = await this.readFileData();
            this.messageCache = this.processChatMessages(encryptedData, false);
            return this.messageCache;
        } catch (error) {
            console.error("❌ ERROR: Decryption failed!", error);
            return [];
        }
    }

    public async loadEncryptedChat(): Promise<ChatMessage[]> {
        try {
            return await this.readFileData();
        } catch (error) {
            console.error("❌ ERROR: Failed to read encrypted chat!", error);
            return [];
        }
    }

    private async appendEncryptedMessage(newMessage: ChatMessage): Promise<void> {
        const encryptedMessage = this.encryptChatMessage(newMessage);
        await this.saveToFile(encryptedMessage);

        if (this.messageCache) {
            this.messageCache = [...this.messageCache, newMessage];
        }

        await Promise.resolve(this.onNewMessage());
    }

    public onNewMessage: () => void | Promise<void> = () => { };

    static isValidChatMessage(data: unknown): data is ChatMessage {
        return (
            typeof data === "object" &&
            data !== null &&
            "nick" in data &&
            "msg" in data &&
            "id" in data &&
            "timestamp" in data &&
            "msgId" in data &&
            typeof (data as ChatMessage).nick === "string" &&
            (data as ChatMessage).nick.trim().length > 0 &&
            typeof (data as ChatMessage).msg === "string" &&
            (data as ChatMessage).msg.trim().length > 0 &&
            typeof (data as ChatMessage).id === "string" &&
            typeof (data as ChatMessage).timestamp === "string" &&
            typeof (data as ChatMessage).msgId === "string"
        );
    }

    static isValidChatRequest(data: unknown): data is ChatRequest {
        return (
            typeof data === "object" &&
            data !== null &&
            "nick" in data &&
            "msg" in data &&
            "ip" in data &&
            "sessionToken" in data &&
            typeof (data as ChatRequest).nick === "string" &&
            (data as ChatRequest).nick.trim().length > 0 &&
            typeof (data as ChatRequest).msg === "string" &&
            (data as ChatRequest).msg.trim().length > 0 &&
            typeof (data as ChatRequest).ip === "string" &&
            typeof (data as ChatRequest).sessionToken === "string" &&
            Chat.isValidIp((data as ChatRequest).ip)
        );
    }

    public clearMessageCache(): void {
        this.messageCache = null;
    }

    static isValidIp(ip: string): boolean {
        return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^[0-9a-fA-F:]+$/.test(ip);
    }

    public readyMessage(): string {
        return this.ready
            ? "💬 Chat is ready."
            : "⚠️ Chat is not ready. Something went wrong.";
    }
}

export default Chat;