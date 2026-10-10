import Chat from "../kittyChat";
import type { Request, Response } from "express";
import type Server from "../baseServer";
import type { tokenStore } from "../tokenStore";

type Constructible = ConstructorParameters<typeof Chat>;
const preservedConstructor: Constructible = [] as unknown as [server: Server, jsonFilePath: string, TokenStore: tokenStore];
void preservedConstructor;
const messageCheck: (value: unknown) => boolean = Chat.isValidChatMessage;
const requestCheck: (value: unknown) => boolean = Chat.isValidChatRequest;
const ipCheck: (ip: string) => boolean = Chat.isValidIp;
void messageCheck;
void requestCheck;
void ipCheck;
function originalMethods(chat: Chat): void {
    const id: string = chat.generateUserId("127.0.0.1");
    const ready: string = chat.readyMessage();
    const messages = chat.processChatMessages([], true);
    const pending: Promise<unknown[]> = chat.loadAndDecryptChat();
    const encrypted: Promise<unknown[]> = chat.loadEncryptedChat();
    chat.clearMessageCache();
    chat.onNewMessage = () => undefined;
    void id;
    void ready;
    void messages;
    void pending;
    void encrypted;
}
void originalMethods;
