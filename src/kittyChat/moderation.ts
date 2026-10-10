import type { OpenAI } from "openai";
import type { ModeratorStrings } from "./types";
import { moderateText } from "../moderation/moderate";

export async function moderateMessage(userMessage: string, strings: { [key: string]: ModeratorStrings }, openai: OpenAI): Promise<string> {
    return moderateText(userMessage, strings, openai, {
        userPromptPrefix: "The user has requested to store the following:",
        emptyContentFallback: "Error moderating the message.",
        errorLogPrefix: "❌ ERROR: AI moderation failed:"
    });
}
