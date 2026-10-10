import fs from "fs";
import type { OpenAI } from "openai";

export interface ModeratorStrings {
    role?: string;
    user?: string;
}

/** Historical URL syntax acceptance, including non-http protocols. */
export function isValidURL(value: string): boolean {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

/** Both endpoint types use the same moderator strings and recovery contract. */
export function loadModeratorStrings(stringsFilePath: string): { [key: string]: ModeratorStrings } {
    try {
        const raw = fs.readFileSync(stringsFilePath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        return parsed as { [key: string]: ModeratorStrings };
    } catch {
        throw new Error("Could not load moderator strings.");
    }
}

/** Only the submitted-content label and error log differ between endpoints. */
export async function moderateSubmittedComment(
    rawMsg: string,
    strings: { [key: string]: ModeratorStrings },
    client: OpenAI,
    submissionKind: "comment" | "RSS post comment",
    failureLog: string,
): Promise<string> {
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
                    content: `The user submitted the following ${submissionKind}:\n\n${rawMsg}`
                }
            ]
        });
        return response.choices[0].message.content ?? "Error moderating comment.";
    } catch (error) {
        console.error(failureLog, error);
        return "ERROR";
    }
}
