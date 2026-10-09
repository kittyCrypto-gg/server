import type { OpenAI } from "openai";
import type { OpenAIAPIErrorShape, ModeratorStrings, CommitEntry, BritishSpellcheckChunkResponse, LineChange, CommitLog } from "./types";

export interface BloggerContext {
  owner: string;
  repo: string;
  openai: OpenAI;
  strings: { [key: string]: ModeratorStrings };
  commitsDir: string;
  postsDir: string;
  splitMarkdown(
    markdown: string,
    maxCharsPerChunk?: number
  ): Array<{ startLine: number; text: string }>;
  ensureDir(dir: string): Promise<void>;
  getLatestJson(): Promise<{ file: string, json: CommitLog } | null>;
  normalise(json: CommitLog, maxDiffCharsPerCommit: number): CommitLog;
  splitJson(
    json: CommitLog,
    maxTokens: number,
    systemPromptTokens: number,
    userPromptTokens: number,
    minCommitsPerChunk?: number
  ): string[];
  buildMergePrompts(summaryBatch: string[], user: string): { systemPrompt: string, userPrompt: string };
  mergeSummariesBatch(summaryBatch: string[], user: string): Promise<string>;
  mergeSummariesBatchSafely(summaryBatch: string[], user: string, maxInputTokens: number): Promise<string>;
  mergeSumm(summaryArray: string[], user?: string): Promise<string>;
  buildSummary(): { systemPrompt: string, userPromptBase: string };
  summariseChunk(systemPrompt: string, userPromptBase: string, jsonChunk: string): Promise<string>;
  toSkinnyLog(log: CommitLog): CommitLog;
  spellcheckMd(
    markdown: string,
    fileName: string
  ): Promise<string | null>;
  spellcheck(targetPaths?: string[]): Promise<void>;
  summariseLatest(user?: string, spellCheck?: boolean): Promise<string[]>;
  summariseAll(user?: string, spellCheck?: boolean): Promise<string[]>;
}
