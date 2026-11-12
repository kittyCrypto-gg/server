import path from "path";
import type { OpenAI } from "openai";
import type { OpenAIAPIErrorShape, ModeratorStrings, CommitEntry, BritishSpellcheckChunkResponse, LineChange, CommitLog } from "./autoBlogger/types";
import type { BloggerContext } from "./autoBlogger/context";
import { diffLines as diffLines_op, splitMarkdown as splitMarkdown_op } from "./autoBlogger/markdown";
import { ensureDir as ensureDir_op, getLatestJson as getLatestJson_op } from "./autoBlogger/history";
import { estimateTokens as estimateTokens_op, truncateDiff as truncateDiff_op, normalise as normalise_op, splitJson as splitJson_op, extractTknCnt as extractTknCnt_op, toSkinnyLog as toSkinnyLog_op } from "./autoBlogger/tokenBudget";
import { buildMergePrompts as buildMergePrompts_op, buildSummary as buildSummary_op } from "./autoBlogger/prompts";
import { mergeSummariesBatch as mergeSummariesBatch_op, mergeSummariesBatchSafely as mergeSummariesBatchSafely_op, mergeSumm as mergeSumm_op, summariseChunk as summariseChunk_op } from "./autoBlogger/summary";
import { spellcheckMd as spellcheckMd_op, spellcheck as spellcheck_op } from "./autoBlogger/spellcheck";
import { summariseLatest as summariseLatest_op } from "./autoBlogger/latest";
import { summariseAll as summariseAll_op } from "./autoBlogger/all";

export type { ModeratorStrings, CommitEntry, CommitLog } from "./autoBlogger/types";

export class autoBlogger {
  private owner: string;
  private repo: string;
  private openai: OpenAI;
  private strings: { [key: string]: ModeratorStrings };
  private commitsDir: string;
  private postsDir: string;

  constructor(
    owner: string,
    repo: string,
    openai: OpenAI,
    strings: { [key: string]: ModeratorStrings },
  ) {
    this.owner = owner;
    this.repo = repo;
    this.openai = openai;
    this.strings = strings;
    this.commitsDir = path.resolve(process.cwd(), "data", "commitsTracker");
    this.postsDir = path.resolve(process.cwd(), "data", "blogposts");
  }

  private static diffLines(before: string, after: string): LineChange[] {
    return diffLines_op(before, after);
  }

  private splitMarkdown(
    markdown: string,
    maxCharsPerChunk = 6000
  ): Array<{ startLine: number; text: string }> {
    return splitMarkdown_op(this as unknown as BloggerContext, markdown, maxCharsPerChunk);
  }

  private async ensureDir(dir: string): Promise<void> {
    return ensureDir_op(this as unknown as BloggerContext, dir);
  }

  private async getLatestJson(): Promise<{ file: string, json: CommitLog } | null> {
    return getLatestJson_op(this as unknown as BloggerContext);
  }

  private static estimateTokens(str: string): number {
    return estimateTokens_op(str);
  }

  private static truncateDiff(diff: string, maxChars: number): string {
    return truncateDiff_op(diff, maxChars);
  }

  private normalise(json: CommitLog, maxDiffCharsPerCommit: number): CommitLog {
    return normalise_op(this as unknown as BloggerContext, json, maxDiffCharsPerCommit);
  }

  private splitJson(
    json: CommitLog,
    maxTokens: number,
    systemPromptTokens: number,
    userPromptTokens: number,
    minCommitsPerChunk: number = 1
  ): string[] {
    return splitJson_op(this as unknown as BloggerContext, json, maxTokens, systemPromptTokens, userPromptTokens, minCommitsPerChunk);
  }

  private static extractTknCnt(err: unknown): number | null {
    return extractTknCnt_op(err);
  }

  private buildMergePrompts(summaryBatch: string[], user: string): { systemPrompt: string, userPrompt: string } {
    return buildMergePrompts_op(this as unknown as BloggerContext, summaryBatch, user);
  }

  private async mergeSummariesBatch(summaryBatch: string[], user: string): Promise<string> {
    return mergeSummariesBatch_op(this as unknown as BloggerContext, summaryBatch, user);
  }

  private async mergeSummariesBatchSafely(summaryBatch: string[], user: string, maxInputTokens: number): Promise<string> {
    return mergeSummariesBatchSafely_op(this as unknown as BloggerContext, summaryBatch, user, maxInputTokens);
  }

  private async mergeSumm(summaryArray: string[], user = "Kitty"): Promise<string> {
    return mergeSumm_op(this as unknown as BloggerContext, summaryArray, user);
  }

  private buildSummary(): { systemPrompt: string, userPromptBase: string } {
    return buildSummary_op(this as unknown as BloggerContext);
  }

  private async summariseChunk(systemPrompt: string, userPromptBase: string, jsonChunk: string): Promise<string> {
    return summariseChunk_op(this as unknown as BloggerContext, systemPrompt, userPromptBase, jsonChunk);
  }

  private toSkinnyLog(log: CommitLog): CommitLog {
    return toSkinnyLog_op(this as unknown as BloggerContext, log);
  }

  private async spellcheckMd(
    markdown: string,
    fileName: string
  ): Promise<string | null> {
    return spellcheckMd_op(this as unknown as BloggerContext, markdown, fileName);
  }

  private async spellcheck(targetPaths?: string[]): Promise<void> {
    return spellcheck_op(this as unknown as BloggerContext, targetPaths);
  }

  public async summariseLatest(user = "autoKitty", spellCheck: boolean = false): Promise<string[]> {
    return summariseLatest_op(this as unknown as BloggerContext, user, spellCheck);
  }

  public async summariseAll(user = "autoKitty", spellCheck: boolean = false): Promise<string[]> {
    return summariseAll_op(this as unknown as BloggerContext, user, spellCheck);
  }
}
