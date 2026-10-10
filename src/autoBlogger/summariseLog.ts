import { estimateTokens, extractTknCnt } from "./tokenBudget";
import type { OpenAIAPIErrorShape, CommitLog } from "./types";
import type { BloggerContext } from "./context";

/** Preserve single-pass, chunking, retry and merge behaviour for both blog sources. */
export async function summariseCommitLog(
    ctx: BloggerContext, json: CommitLog, user: string, sourceFile?: string
): Promise<string> {
      const { systemPrompt, userPromptBase } = ctx.buildSummary();
      const splitLabel = sourceFile ? `${sourceFile} split into` : 'Splitting into';
      const chunkLabel = sourceFile ? `${sourceFile} chunk` : 'Chunk';

      const modelContextLimit = 128_000;
      const responseBufferTokens = 2048;
      const safetyBufferTokens = 4096;

      const maxDiffCharsPerCommit = 10_000;
      const maxTokensPerChunk = 24_000;

      const llmLog = ctx.normalise(json, maxDiffCharsPerCommit);
      const jsonText = JSON.stringify(llmLog, null, 2);

      const systemPromptTokens = estimateTokens(systemPrompt);
      const userPromptTokens = estimateTokens(userPromptBase);

      const wholeEstimate =
        systemPromptTokens +
        userPromptTokens +
        estimateTokens(jsonText) +
        responseBufferTokens +
        safetyBufferTokens;

      const summaries: string[] = [];
      const canTrySingle = wholeEstimate < modelContextLimit;

      if (canTrySingle) {
        try {
          summaries.push(await ctx.summariseChunk(systemPrompt, userPromptBase, jsonText));
        } catch (err) {
          const hint = extractTknCnt(err as OpenAIAPIErrorShape);
          console.warn(
            `[autoBlogger][${ctx.repo}] Single-pass summarise failed, falling back to chunking.` +
            (hint ? ` tokens=${hint}` : '')
          );
        }
      }

      if (summaries.length === 0) {
        const chunks = ctx.splitJson(
          llmLog,
          maxTokensPerChunk,
          systemPromptTokens,
          userPromptTokens
        );

        console.log(`[autoBlogger][${ctx.repo}] ${splitLabel} ${chunks.length} chunk(s).`);

        for (let i = 0; i < chunks.length; i += 1) {
          const chunk = chunks[i];

          try {
            summaries.push(await ctx.summariseChunk(systemPrompt, userPromptBase, chunk));
            continue;
          } catch (chunkErr) {
            const hint = extractTknCnt(chunkErr as OpenAIAPIErrorShape);
            console.warn(
              `[autoBlogger][${ctx.repo}] ${chunkLabel} ${i + 1}/${chunks.length} failed.` +
              (hint ? ` tokens=${hint}` : '')
            );
          }

          const parsed = JSON.parse(chunk) as CommitLog;
          const skinny = ctx.toSkinnyLog(parsed);
          summaries.push(await ctx.summariseChunk(systemPrompt, userPromptBase, JSON.stringify(skinny, null, 2)));
        }
      }

      return await ctx.mergeSumm(summaries, user);
}
