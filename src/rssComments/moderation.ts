import type { OpenAI } from "openai";
import type { ModeratorStrings } from "./types";
import { moderateSubmittedComment } from "../comments/shared";

/** Maintain the original RSS-specific prompt and error log contract. */
export async function moderateComment(rawMsg: string, strings: { [key: string]: ModeratorStrings }, client: OpenAI): Promise<string> {
    return moderateSubmittedComment(rawMsg, strings, client, "RSS post comment", "❌ RSS comment AI moderation failed:");
}
