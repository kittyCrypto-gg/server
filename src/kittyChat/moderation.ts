import type { OpenAI } from "openai";
import type { ModeratorStrings } from "./types";

export async function moderateMessage(userMessage: string, strings: { [key: string]: ModeratorStrings }, openai: OpenAI): Promise<string> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content:
                        strings.moderator?.role ||
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
