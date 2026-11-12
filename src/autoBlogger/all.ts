import * as fs from "fs/promises";
import path from "path";
import { estimateTokens, extractTknCnt } from "./tokenBudget";
import type { OpenAIAPIErrorShape, ModeratorStrings, CommitEntry, BritishSpellcheckChunkResponse, LineChange, CommitLog } from "./types";
import type { BloggerContext } from "./context";

export async function summariseAll(ctx: BloggerContext, user = "autoKitty", spellCheck: boolean = false): Promise<string[]> {
    await ctx.ensureDir(ctx.postsDir);

    const outPaths: string[] = [];

    try {
      const pattern = new RegExp(`-GithubTracker-${ctx.owner}-${ctx.repo}\\.json$`);
      const files = (await fs.readdir(ctx.commitsDir))
        .filter(f => pattern.test(f))
        .sort();

      const stampTracker = (fileName: string): string => {
        const match = /^(\d{8}-\d{6})-GithubTracker-/.exec(fileName);
        return match ? match[1] : "unknown";
      };

      for (const file of files) {
        const fullPath = path.join(ctx.commitsDir, file);
        const raw = await fs.readFile(fullPath, "utf-8");

        let json: CommitLog;
        try {
          json = JSON.parse(raw) as CommitLog;
        } catch {
          console.warn(`[autoBlogger][${ctx.repo}] Skipping invalid JSON file: ${file}`);
          continue;
        }

        if (json.blogged === true) continue;

        const { systemPrompt, userPromptBase } = ctx.buildSummary();

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

          console.log(`[autoBlogger][${ctx.repo}] ${file} split into ${chunks.length} chunk(s).`);

          for (let i = 0; i < chunks.length; i += 1) {
            const chunk = chunks[i];

            try {
              summaries.push(await ctx.summariseChunk(systemPrompt, userPromptBase, chunk));
              continue;
            } catch (chunkErr) {
              const hint = extractTknCnt(chunkErr as OpenAIAPIErrorShape);
              console.warn(
                `[autoBlogger][${ctx.repo}] ${file} chunk ${i + 1}/${chunks.length} failed.` +
                (hint ? ` tokens=${hint}` : '')
              );
            }

            const parsed = JSON.parse(chunk) as CommitLog;
            const skinny = ctx.toSkinnyLog(parsed);
            summaries.push(await ctx.summariseChunk(systemPrompt, userPromptBase, JSON.stringify(skinny, null, 2)));
          }
        }

        const merged = await ctx.mergeSumm(summaries, user);

        const stamp = stampTracker(file);
        const fileName = `autoBlogger-commits-${stamp}-${user}-${ctx.repo}.md`;
        const postPath = path.join(ctx.postsDir, fileName);

        await fs.writeFile(postPath, merged, "utf-8");

        json.blogged = true;
        await fs.writeFile(fullPath, JSON.stringify(json, null, 2), "utf-8");

        outPaths.push(postPath);
      }

      return outPaths;
    } finally {
      if (spellCheck && outPaths.length > 0)
        await ctx.spellcheck(outPaths);
    }
}
