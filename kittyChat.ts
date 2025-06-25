import crypto from "crypto";
import fs from "fs";
import { Request, Response } from "express";
import { OpenAI } from "openai";
import Server from "./baseServer";
import KittyRequest from "./kittyRequest";

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
    private strings: { [key: string]: ModeratorStrings };
    private messageCache: ChatMessage[] | null = null;

    constructor(server: Server, jsonFilePath: string, sessionTokens: Set<string>) {
        super(server, jsonFilePath, sessionTokens, Chat.isValidChatMessage);

        // Register the chat endpoint
        this.server.app.post("/chat", async (req: Request, res: Response) => {
            await this.handleRequest(req, res, () => this.storeMessage(req, res));
        });

        this.server.app.post("/chat/edit", async (req: Request, res: Response) => {
            await this.handleRequest(req, res, () => this.editMessage(req, res));
        });

        this.server.app.post("/chat/delete", async (req: Request, res: Response) => {
            await this.deleteMessage(req, res);
        });

        //this.server.logEndpoints();

        this.strings = JSON.parse(fs.readFileSync("./strings.json", "utf-8"));
    }

    private findMessageData(msgId: string): { messages: ChatMessage[], message: ChatMessage | undefined, index: number } {
        try {
            const messages = this.loadAndDecryptChat();
            const index = messages.findIndex(m => m.msgId === msgId);
            const message = index === -1 ? undefined : messages[index];
            return { messages, message, index };
        } catch (error) {
            console.error("❌ Error fetching message data:", error);
            return { messages: [], message: undefined, index: -1 };
        }
    }

    private async editMessage(req: Request, res: Response): Promise<object> {
        this.clearMessageCache(); // Invalidate cache
        const { msgId, sessionToken, ip, newMessage } = req.body;
        if (!msgId || !sessionToken || !ip || !newMessage) {
            return { error: "Missing required parameters" };
        }

        try {
            const { messages, message, index } = this.findMessageData(msgId);
            if (!message) return { error: "Message not found" };

            const msgIdBint = BigInt(msgId);
            const sessionBint = BigInt(`0x${sessionToken}`);

            if (msgIdBint % sessionBint !== BigInt(0)) return res.status(403).send({ error: "Unauthorized" });

            console.log(`✏️ Editing message ${msgId}`);
            message.msg = newMessage;
            message.edited = true;
            messages[index] = message;

            const encryptedData = this.processChatMessages(messages, true);
            await fs.promises.writeFile(this.jsonFilePath, JSON.stringify(encryptedData, null, 2), "utf-8");

            return { success: true };
        } catch (error) {
            console.error("❌ Error processing edit request:", error);
            return { error: "Internal Server Error" };
        }
    }

    private async deleteMessage(req: Request, res: Response): Promise<object> {
        this.clearMessageCache(); // Invalidate cache
        const { msgId, sessionToken, ip } = req.body;
        if (!msgId || !sessionToken || !ip) {
            return { error: "Missing required parameters" };
        }

        try {
            const { messages, message, index } = this.findMessageData(msgId);
            console.log(`🗑️ Deleting message ${msgId}`);

            // Remove the message from the array
            if (index === -1) return { error: "Message not found" };
            messages.splice(index, 1);

            // Encrypt and save the updated messages
            const encryptedData = this.processChatMessages(messages, true);
            await fs.promises.writeFile(this.jsonFilePath, JSON.stringify(encryptedData, null, 2), "utf-8");

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
                        content: this.strings.moderator.role || "You are a moderator. Please moderate the following message:",
                    },
                    { role: "user", content: `The user has requested to store the following:\n\n${userMessage}` },
                ],
            });

            return response.choices[0].message.content ?? "Error moderating the message.";
        } catch (error) {
            console.error("❌ ERROR: AI moderation failed:", error);
            return "ERROR"; // Fallback if OpenAI is unreachable
        }
    }

    protected async storeMessage(req: Request, res: Response): Promise<object> {
        const body = req.body;
        const requestData = body.chatRequest;

        if (!Chat.isValidChatRequest(requestData)) {
            return { error: "Invalid chat request structure." };
        }
        const { nick, msg, ip, sessionToken } = requestData;
        // Convert first 16 hex characters  of sessionToken to an integer
        const userId = this.generateUserId(ip);
        // 🛡️ Pass Message Through AI Moderation
        const safeMsg = await this.moderateMessage(msg);
        const timestamp = new Date().toISOString();
        const newMessage: ChatMessage = {
            nick,
            id: userId,
            msg: safeMsg,
            timestamp,
            msgId: this.generateMsgId(userId, timestamp, sessionToken)
        };

        await this.appendEncryptedMessage(newMessage);
        return { success: true, nick, id: userId, msg: safeMsg, msgId: newMessage.msgId };
    }

    private generateMsgId(id: string, timestamp: string, sessionToken: string): string {
        const unixTimestamp = Math.floor(new Date(timestamp).getTime() / 1000);
        const salt = crypto.randomBytes(8).toString("hex");
        const hash = crypto.createHash("sha256").update(`${id}${unixTimestamp}${sessionToken}${salt}`).digest("hex");
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

        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-256-cbc", CHAT_KEY, iv);
        const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

        return iv.toString("hex") + ":" + encrypted.toString("hex");
    }

    private decryptValue(encryptedValue: string): string {
        try {
            const parts = encryptedValue.split(":");
            if (parts.length !== 2) throw new Error("Invalid encrypted format");

            const iv = Buffer.from(parts[0], "hex");
            const encryptedText = Buffer.from(parts[1], "hex");

            if (!CHAT_KEY) {
                throw new Error("CHAT_KEY is missing. Ensure it is properly set.");
            }

            if (CHAT_KEY.length !== 32) {
                throw new Error(`CHAT_KEY must be exactly 32 bytes, but got ${CHAT_KEY.length} bytes.`);
            }

            const decipher = crypto.createDecipheriv("aes-256-cbc", CHAT_KEY, iv);
            const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);

            return decrypted.toString("utf8");
        } catch (error) {
            console.error("❌ ERROR: Decryption failed!", error);
            return "ERROR"; // Handle decryption failure gracefully
        }
    }

    public processChatMessages(messages: ChatMessage[], encrypt: boolean): ChatMessage[] {
        return messages.map(msg => ({
            nick: encrypt ? this.encryptValue(msg.nick) : this.decryptValue(msg.nick),
            id: encrypt ? this.encryptValue(msg.id) : this.decryptValue(msg.id),
            msg: encrypt ? this.encryptValue(msg.msg) : this.decryptValue(msg.msg),
            msgId: msg.msgId,
            timestamp: new Date().toISOString(),
            ...(msg.edited ? { edited: true } : {})
        }));
    }

    public loadAndDecryptChat(): ChatMessage[] {
        if (this.messageCache) return this.messageCache;

        try {
            if (!fs.existsSync(this.jsonFilePath)) return [];
            const encryptedData = JSON.parse(fs.readFileSync(this.jsonFilePath, "utf-8"));
            this.messageCache = this.processChatMessages(encryptedData, false);
            return this.messageCache;
        } catch (error) {
            console.error("❌ ERROR: Decryption failed!", error);
            return [];
        }
    }

    private async appendEncryptedMessage(newMessage: ChatMessage): Promise<void> {
        this.clearMessageCache(); // Invalidate cache
        // Only read file if cache is null
        let chatHistory = this.messageCache ?? this.loadAndDecryptChat();
        chatHistory.push(newMessage);
        const encryptedData = this.processChatMessages(chatHistory, true);
        await fs.promises.writeFile(this.jsonFilePath, JSON.stringify(encryptedData, null, 2), "utf-8")
        this.onNewMessage();
    }

    public onNewMessage: () => void = () => { };

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
}

export default Chat;