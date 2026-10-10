import type { Request, Response } from "express";
import type { ChatMessage } from "./types";

export interface ChatMutationContext {
    messageCache: ChatMessage[] | null;
    clearMessageCache(): void;
    processChatMessages(messages: ChatMessage[], encrypt: boolean): ChatMessage[];
    updateFileData(
        update: (current: ChatMessage[]) => ChatMessage[] | Promise<ChatMessage[]>
    ): Promise<ChatMessage[]>;
}

/**
 * Same storage/ownership/cache flow for the historical edit and delete handlers.
 * Keep the original ordering of validation, message search, BigInt ownership,
 * persisted encrypted update and HTTP 403 responses.
 */
export async function mutateChatMessage(
    ctx: ChatMutationContext,
    kind: "edit" | "delete",
    req: Request,
    res: Response
): Promise<object> {
    ctx.clearMessageCache();

    const { msgId, sessionToken, ip } = req.body;
    const newMessage = kind === "edit" ? req.body.newMessage : undefined;

    if (
        typeof msgId !== "string" ||
        typeof sessionToken !== "string" ||
        typeof ip !== "string" ||
        (kind === "edit" && (typeof newMessage !== "string" || newMessage.trim().length === 0))
    ) {
        return { error: "Missing required parameters" };
    }

    try {
        let found = false;
        let unauthorised = false;
        let updatedMessages: ChatMessage[] | null = null;

        await ctx.updateFileData(async (currentEncrypted: ChatMessage[]): Promise<ChatMessage[]> => {
            const messages = ctx.processChatMessages(currentEncrypted, false);
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

            console.log(kind === "edit" ? `✏️ Editing message ${msgId}` : `🗑️ Deleting message ${msgId}`);

            let nextMessages: ChatMessage[];
            if (kind === "edit") {
                nextMessages = [...messages];
                nextMessages[index] = {
                    ...nextMessages[index],
                    msg: newMessage,
                    edited: true,
                };
            } else {
                nextMessages = messages.filter((_, messageIndex) => messageIndex !== index);
            }

            updatedMessages = nextMessages;
            return ctx.processChatMessages(nextMessages, true);
        });

        if (!found) {
            return { error: "Message not found" };
        }

        if (unauthorised) {
            return res.status(403).send({ error: "Unauthorised" });
        }

        ctx.messageCache = updatedMessages;
        return { success: true };
    } catch (error) {
        console.error(
            kind === "edit" ? "❌ Error processing edit request:" : "❌ Error processing delete request:",
            error
        );
        return { error: "Internal Server Error" };
    }
}
