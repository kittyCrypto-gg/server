import * as fs from "fs/promises";
import path from "path";
import { estimateTokens, extractTknCnt } from "./tokenBudget";
import type { OpenAIAPIErrorShape, ModeratorStrings, CommitEntry, BritishSpellcheckChunkResponse, LineChange, CommitLog } from "./types";
import type { BloggerContext } from "./context";

export async function summariseLatest(ctx: BloggerContext, user = "autoKitty", spellCheck: boolean = false): Promise<string[]> {
    await ctx.ensureDir(ctx.postsDir);

    const outPaths: string[] = [];

    try {
      const latest = await ctx.getLatestJson();
      if (!latest) throw new Error('No commit history found.');

      if (latest.json.blogged === true) return [];

      const { systemPrompt, userPromptBase } = ctx.buildSummary();

      const modelContextLimit = 128_000;
      const responseBufferTokens = 2048;
      const safetyBufferTokens = 4096;

      const maxDiffCharsPerCommit = 10_000;
      const maxTokensPerChunk = 24_000;

      const llmLog = ctx.normalise(latest.json, maxDiffCharsPerCommit);
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

        console.log(`[autoBlogger][${ctx.repo}] Splitting into ${chunks.length} chunk(s).`);

        for (let i = 0; i < chunks.length; i += 1) {
          const chunk = chunks[i];

          try {
            summaries.push(await ctx.summariseChunk(systemPrompt, userPromptBase, chunk));
            continue;
          } catch (chunkErr) {
            const hint = extractTknCnt(chunkErr as OpenAIAPIErrorShape);
            console.warn(
              `[autoBlogger][${ctx.repo}] Chunk ${i + 1}/${chunks.length} failed.` +
              (hint ? ` tokens=${hint}` : '')
            );
          }

          const parsed = JSON.parse(chunk) as CommitLog;
          const skinny = ctx.toSkinnyLog(parsed);
          summaries.push(await ctx.summariseChunk(systemPrompt, userPromptBase, JSON.stringify(skinny, null, 2)));
        }
      }

      const merged = await ctx.mergeSumm(summaries, user);

      const now = new Date();
      const y = now.getFullYear();
      const m = (now.getMonth() + 1).toString().padStart(2, '0');
      const d = now.getDate().toString().padStart(2, '0');
      const hh = now.getHours().toString().padStart(2, '0');
      const mm = now.getMinutes().toString().padStart(2, '0');

      const fileName = `autoBlogger-commits-${y}${m}${d}-${hh}:${mm}-${user}-${ctx.repo}.md`;
      const filePath = path.join(ctx.postsDir, fileName);

      await fs.writeFile(filePath, merged, 'utf-8');
      outPaths.push(filePath);

      latest.json.blogged = true;
      await fs.writeFile(path.join(ctx.commitsDir, latest.file), JSON.stringify(latest.json, null, 2), 'utf-8');

      return outPaths;
    } finally {
      if (spellCheck && outPaths.length > 0)
        await ctx.spellcheck(outPaths);
    }
}
