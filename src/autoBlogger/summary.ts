import { estimateTokens } from "./tokenBudget";
import type { OpenAIAPIErrorShape, ModeratorStrings, CommitEntry, BritishSpellcheckChunkResponse, LineChange, CommitLog } from "./types";
import type { BloggerContext } from "./context";

export async function mergeSummariesBatch(ctx: BloggerContext, summaryBatch: string[], user: string): Promise<string> {
    const { systemPrompt, userPrompt } = ctx.buildMergePrompts(summaryBatch, user);

    const response = await ctx.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 1536
    });

    return response.choices[0].message.content ?? "Error merging blog summaries.";
}

export async function mergeSummariesBatchSafely(ctx: BloggerContext, summaryBatch: string[], user: string, maxInputTokens: number): Promise<string> {
    const cleaned = summaryBatch.map(s => s.trim()).filter(s => s.length > 0);

    if (cleaned.length === 0) return "No changes detected.";
    if (cleaned.length === 1) return cleaned[0];

    const { systemPrompt, userPrompt } = ctx.buildMergePrompts(cleaned, user);
    const estimated =
      estimateTokens(systemPrompt) +
      estimateTokens(userPrompt) +
      4096;

    if (estimated <= maxInputTokens) {
      return ctx.mergeSummariesBatch(cleaned, user);
    }

    const mid = Math.ceil(cleaned.length / 2);
    const left = await ctx.mergeSummariesBatchSafely(cleaned.slice(0, mid), user, maxInputTokens);
    const right = await ctx.mergeSummariesBatchSafely(cleaned.slice(mid), user, maxInputTokens);
    return ctx.mergeSummariesBatchSafely([left, right], user, maxInputTokens);
}

export async function mergeSumm(ctx: BloggerContext, summaryArray: string[], user = "Kitty"): Promise<string> {
    const cleaned = summaryArray.map(s => s.trim()).filter(s => s.length > 0);

    if (cleaned.length === 0) return "No changes detected.";
    if (cleaned.length === 1) return cleaned[0];

    const maxInputTokens = 80_000;

    let current = cleaned;
    const batchSize = 8;

    while (current.length > 1) {
      const next: string[] = [];

      for (let i = 0; i < current.length; i += batchSize) {
        const batch = current.slice(i, i + batchSize);
        next.push(await ctx.mergeSummariesBatchSafely(batch, user, maxInputTokens));
      }

      current = next;
    }

    return current[0];
}

export async function summariseChunk(ctx: BloggerContext, systemPrompt: string, userPromptBase: string, jsonChunk: string): Promise<string> {
    const response = await ctx.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPromptBase + `\n${jsonChunk}` }
      ],
      temperature: 0.7,
      max_tokens: 1024
    });

    return response.choices[0].message.content ?? "";
}
