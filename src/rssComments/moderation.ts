import type { OpenAI } from "openai";
import type { ModeratorStrings } from "./types";
import { moderateText } from "../moderation/moderate";

export async function moderateComment(rawMsg: string, strings: { [key: string]: ModeratorStrings }, client: OpenAI): Promise<string> {
    return moderateText(rawMsg, strings, client, {
        userPromptPrefix: "The user submitted the following RSS post comment:",
        emptyContentFallback: "Error moderating comment.",
        errorLogPrefix: "❌ RSS comment AI moderation failed:"
    });
}
