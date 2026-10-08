import type { OpenAI } from "openai";
import type { BumpTier, DecimalPrecision, DecimalVersion, RepoIdentifier, CommitSummary, RepoHistory, SetverDirective, GitHubCommit, LlmTierJson } from "./types";

/** Internal view of the original tracker, without changing its public class contract. */
export interface TrackerContext {
  owner: string;
  repos: RepoIdentifier[];
  outDir: string;
  githubToken: string | undefined;
  openai: OpenAI | null;
  getHeaders(): Record<string, string>;
  ensureDir(): Promise<void>;
  getNow(): string;
  stampFromDate(d: Date): string;
  stampFromIso(iso: string): string;
  bumpStampByOneSecond(stamp: string): string;
  getHistoryFilePattern(repo: string): RegExp;
  getLatestHistoryFile(repo: string): Promise<{ file: string; data: RepoHistory } | null>;
  safeDate(value: string | undefined): Date | null;
  compSince(fallbackSinceDays: number, lastCommitDate: string | undefined): string;
  parseLink(linkHeader: string | null): Record<string, string>;
  normCommItems(raw: unknown): GitHubCommit[];
  fetchCommItms(
    repo: RepoIdentifier,
    branch: string,
    sinceIso: string,
    stopSha: string
  ): Promise<GitHubCommit[]>;
  fetchAll(
    repo: RepoIdentifier,
    branch: string
  ): Promise<GitHubCommit[]>;
  genTier(message: string, diff: string): Promise<Exclude<BumpTier, "skip">>;
  getCommits(
    branch?: string,
    sinceDays?: number
  ): Promise<Record<RepoIdentifier, RepoHistory>>;
  rebuildAll(
    branch?: string,
    commitsPerFile?: number
  ): Promise<Record<RepoIdentifier, RepoHistory[]>>;
  getMdVer(repo: RepoIdentifier, branch: string): Promise<{ major: number; readmeSha: string }>;
  fetchCommits(
    repo: RepoIdentifier,
    branch: string,
    sinceIso: string,
    versionInfo: { major: number; readmeSha: string },
    stopSha: string
  ): Promise<CommitSummary[]>;
  tryReadmeMajorAtSha(repo: RepoIdentifier, sha: string, fallbackMajor: number): Promise<number>;
  fetchDiff(repo: RepoIdentifier, sha: string): Promise<string>;
}
