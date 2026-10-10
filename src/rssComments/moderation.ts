import type { OpenAI } from "openai";
import type { ModeratorStrings } from "./types";

    export async function moderateComment(rawMsg: string, strings: { [key: string]: ModeratorStrings }, client: OpenAI): Promise<string> {
        try {
            const response = await client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content:
                            strings.moderator?.role ||
                            "You are a moderator. Please moderate the following message:"
                    },
                    {
                        role: "user",
                        content: `The user submitted the following RSS post comment:\n\n${rawMsg}`
                    }
                ]
            });

            return response.choices[0].message.content ?? "Error moderating comment.";
        } catch (error) {
            console.error("❌ RSS comment AI moderation failed:", error);
            return "ERROR";
        }
    }

