import { Request, Response } from "express";
import { OpenAI } from "openai";
import Server from "./baseServer";
import KittyRequest from "./kittyRequest";
import { tokenStore } from "./tokenStore";
import path from "path";
/* @ts-ignore */
import "dotenv/config";
import type { ChatMessage, ChatRequest, ModeratorStrings } from "./kittyChat/types";
import { encryptValue, decryptValue, encryptChatMessage, decryptChatMessage, generateMsgId, generateUserId } from "./kittyChat/crypto";
import { loadModeratorStrings } from "./kittyChat/moderatorStrings";
import { moderateMessage } from "./kittyChat/moderation";
import { mutateChatMessage, type ChatMutationContext } from "./kittyChat/mutations";


const apiKey = process.env.OPENAI_KEY || "";
const openai = new OpenAI({ apiKey });


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
        return loadModeratorStrings(this.stringsFilePath);
    }

    private async editMessage(req: Request, res: Response): Promise<object> {
        return mutateChatMessage(this as unknown as ChatMutationContext, "edit", req, res);
    }

    private async deleteMessage(req: Request, res: Response): Promise<object> {
        return mutateChatMessage(this as unknown as ChatMutationContext, "delete", req, res);
    }

    private async moderateMessage(userMessage: string): Promise<string> {
        return await moderateMessage(userMessage, this.strings, openai);
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
        return generateMsgId(id, timestamp, sessionToken);
    }

    public generateUserId(ip: string): string {
        return generateUserId(ip);
    }

    private encryptValue(value: string): string {
        return encryptValue(value);
    }

    private decryptValue(encryptedValue: string): string {
        return decryptValue(encryptedValue);
    }

    private encryptChatMessage(message: ChatMessage): ChatMessage {
        return encryptChatMessage(message);
    }

    private decryptChatMessage(message: ChatMessage): ChatMessage {
        return decryptChatMessage(message);
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
