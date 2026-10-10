import type { OpenAI } from "openai";

export type ModerationProfile = {
    userPromptPrefix: string;
    emptyContentFallback: string;
    errorLogPrefix: string;
};

/** Shared LLM call; individual callers retain their exact prompts and error contracts. */
export async function moderateText(
    text: string,
    strings: Record<string, { role?: string; user?: string }>,
    client: OpenAI,
    profile: ModerationProfile,
): Promise<string> {
    try {
        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: strings.moderator?.role ||
                        "You are a moderator. Please moderate the following message:"
                },
                {
                    role: "user",
                    content: `${profile.userPromptPrefix}\n\n${text}`
                }
            ]
        });
        return response.choices[0].message.content ?? profile.emptyContentFallback;
    } catch (error) {
        console.error(profile.errorLogPrefix, error);
        return "ERROR";
    }
}
