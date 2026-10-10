import type { OpenAIAPIErrorShape, ModeratorStrings, CommitEntry, BritishSpellcheckChunkResponse, LineChange, CommitLog } from "./types";
import type { BloggerContext } from "./context";
import { estimateTokens, truncateDiff } from "../textBudget";
export { estimateTokens, truncateDiff } from "../textBudget";

export function normalise(ctx: BloggerContext, json: CommitLog, maxDiffCharsPerCommit: number): CommitLog {
    return {
      repo: json.repo,
      createdAt: json.createdAt,
      blogged: json.blogged,
      commits: json.commits.map(c => ({
        ...c,
        diff: truncateDiff(c.diff ?? '', maxDiffCharsPerCommit)
      }))
    };
}

export function splitJson(
    ctx: BloggerContext,
    json: CommitLog,
    maxTokens: number,
    systemPromptTokens: number,
    userPromptTokens: number,
    minCommitsPerChunk: number = 1
  ): string[] {
    const { commits, ...headerObj } = json;
    const totalCommits = commits.length;

    if (totalCommits === 0) {
      return [JSON.stringify({ ...headerObj, commits: [] }, null, 2)];
    }

    const headerString = JSON.stringify(headerObj, null, 2);
    const staticTokens =
      estimateTokens(headerString) +
      systemPromptTokens +
      userPromptTokens +
      256;

    const allCommitsTokens = staticTokens + estimateTokens(JSON.stringify(commits, null, 2));
    if (allCommitsTokens < maxTokens) {
      return [JSON.stringify({ ...headerObj, commits }, null, 2)];
    }

    let low = Math.max(1, minCommitsPerChunk);
    let high = totalCommits;
    let lastGood = low;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const chunkCommits = commits.slice(0, mid);
      const tokens = staticTokens + estimateTokens(JSON.stringify(chunkCommits, null, 2));

      if (tokens < maxTokens) {
        lastGood = mid;
        low = mid + 1;
        continue;
      }

      high = mid - 1;
    }

    const chunkSize = Math.max(1, lastGood);

    const result: string[] = [];
    for (let i = 0; i < totalCommits; i += chunkSize) {
      const chunkCommits = commits.slice(i, i + chunkSize);
      result.push(JSON.stringify({ ...headerObj, commits: chunkCommits }, null, 2));
    }

    return result;
}

export function extractTknCnt(err: unknown): number | null {
    if (!err || typeof err !== "object") return null;

    const errAny = err as {
      message?: unknown;
      error?: { message?: unknown };
    };

    const msg =
      (typeof errAny.error?.message === "string" && errAny.error.message) ||
      (typeof errAny.message === "string" && errAny.message) ||
      "";

    const match = msg.match(/resulted in (\d+) tokens/);
    return match ? Number(match[1]) : null;
}

export function toSkinnyLog(ctx: BloggerContext, log: CommitLog): CommitLog {
    return {
      repo: log.repo,
      createdAt: log.createdAt,
      blogged: log.blogged,
      commits: log.commits.map(c => ({
        ...c,
        diff: ''
      }))
    };
}
