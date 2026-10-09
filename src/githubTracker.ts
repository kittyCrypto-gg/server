import { OpenAI } from "openai";
import path from "path";
import "dotenv/config";
import type { BumpTier, DecimalPrecision, DecimalVersion, RepoIdentifier, CommitSummary, RepoHistory, SetverDirective, GitHubCommit, LlmTierJson } from "./githubTracker/types";
import type { TrackerContext } from "./githubTracker/context";
import { ensureDir as ensureDir_op, getNow as getNow_op, stampFromDate as stampFromDate_op, stampFromIso as stampFromIso_op, bumpStampByOneSecond as bumpStampByOneSecond_op, getHistoryFilePattern as getHistoryFilePattern_op, getLatestHistoryFile as getLatestHistoryFile_op, safeDate as safeDate_op, compSince as compSince_op } from "./githubTracker/historyStore";
import { getHeaders as getHeaders_op, parseLink as parseLink_op, normCommItems as normCommItems_op, fetchCommItms as fetchCommItms_op, fetchAll as fetchAll_op, getMdVer as getMdVer_op, fetchCommits as fetchCommits_op, tryReadmeMajorAtSha as tryReadmeMajorAtSha_op, fetchDiff as fetchDiff_op } from "./githubTracker/githubApi";
import { clampDigit as clampDigit_op, parseVer as parseVer_op, formatVer as formatVer_op, withPrecisionFloor as withPrecisionFloor_op, incAt as incAt_op, bumpMajorTier as bumpMajorTier_op, bumpRefactorTier as bumpRefactorTier_op, bumpFeatTier as bumpFeatTier_op, bumpMinorTier as bumpMinorTier_op, bumpFixTier as bumpFixTier_op, bumpTinyTier as bumpTinyTier_op, setverToReadmeMajor as setverToReadmeMajor_op, bumpVer as bumpVer_op, parseSetverDirective as parseSetverDirective_op, tierFromMsg as tierFromMsg_op } from "./githubTracker/versioning";
import { estTokens as estTokens_op, truncateDiff as truncateDiff_op, parseTJson as parseTJson_op, genTier as genTier_op } from "./githubTracker/tierClassifier";
import { getCommits as getCommits_op } from "./githubTracker/incremental";
import { rebuildAll as rebuildAll_op } from "./githubTracker/rebuild";

export class GirhubTracker {
  private owner: string;
  private repos: RepoIdentifier[];
  private outDir: string;
  private githubToken: string | undefined;
  private openai: OpenAI | null;

  constructor(
    owner: string,
    repos: RepoIdentifier | RepoIdentifier[],
    outDir = 'commitsTracker',
    openai?: OpenAI
  ) {
    this.owner = owner;
    this.repos = Array.isArray(repos) ? repos : [repos];
    this.outDir = path.resolve(process.cwd(), "data", outDir);
    this.githubToken = process.env.GITHUB_TOKEN;

    const apiKey = process.env.OPENAI_KEY || "";
    this.openai = openai ?? (apiKey ? new OpenAI({ apiKey }) : null);

    if (!this.githubToken) {
      console.warn('Warning: No GITHUB_TOKEN found in environment. API requests may be severely rate-limited.');
    }

    if (!this.openai) {
      console.warn('Warning: No OPENAI_KEY found (and no OpenAI client provided). Untagged commits will default to !tiny.');
    }
  }

  private getHeaders(): Record<string, string> {
    return getHeaders_op(this as unknown as TrackerContext);
  }

  private async ensureDir(): Promise<void> {
    return ensureDir_op(this as unknown as TrackerContext);
  }

  private getNow(): string {
    return getNow_op(this as unknown as TrackerContext);
  }

  private stampFromDate(d: Date): string {
    return stampFromDate_op(this as unknown as TrackerContext, d);
  }

  private stampFromIso(iso: string): string {
    return stampFromIso_op(this as unknown as TrackerContext, iso);
  }

  private bumpStampByOneSecond(stamp: string): string {
    return bumpStampByOneSecond_op(this as unknown as TrackerContext, stamp);
  }

  private getHistoryFilePattern(repo: string): RegExp {
    return getHistoryFilePattern_op(this as unknown as TrackerContext, repo);
  }

  private async getLatestHistoryFile(repo: string): Promise<{ file: string; data: RepoHistory } | null> {
    return getLatestHistoryFile_op(this as unknown as TrackerContext, repo);
  }

  private safeDate(value: string | undefined): Date | null {
    return safeDate_op(this as unknown as TrackerContext, value);
  }

  private compSince(fallbackSinceDays: number, lastCommitDate: string | undefined): string {
    return compSince_op(this as unknown as TrackerContext, fallbackSinceDays, lastCommitDate);
  }

  private parseLink(linkHeader: string | null): Record<string, string> {
    return parseLink_op(this as unknown as TrackerContext, linkHeader);
  }

  private normCommItems(raw: unknown): GitHubCommit[] {
    return normCommItems_op(this as unknown as TrackerContext, raw);
  }

  private async fetchCommItms(
    repo: RepoIdentifier,
    branch: string,
    sinceIso: string,
    stopSha: string
  ): Promise<GitHubCommit[]> {
    return fetchCommItms_op(this as unknown as TrackerContext, repo, branch, sinceIso, stopSha);
  }

  private async fetchAll(
    repo: RepoIdentifier,
    branch: string
  ): Promise<GitHubCommit[]> {
    return fetchAll_op(this as unknown as TrackerContext, repo, branch);
  }

  private static clampDigit(n: number): number {
    return clampDigit_op(n);
  }

  private static parseVer(version: string): DecimalVersion {
    return parseVer_op(version);
  }

  private static formatVer(v: DecimalVersion): string {
    return formatVer_op(v);
  }

  private static withPrecisionFloor(v: DecimalVersion, precision: DecimalPrecision): DecimalVersion {
    return withPrecisionFloor_op(v, precision);
  }

  private static incAt(v: DecimalVersion, idx: 0 | 1 | 2 | 3 | 4): DecimalVersion {
    return incAt_op(v, idx);
  }

  private static bumpMajorTier(base: DecimalVersion): DecimalVersion {
    return bumpMajorTier_op(base);
  }

  private static bumpRefactorTier(base: DecimalVersion): DecimalVersion {
    return bumpRefactorTier_op(base);
  }

  private static bumpFeatTier(base: DecimalVersion): DecimalVersion {
    return bumpFeatTier_op(base);
  }

  private static bumpMinorTier(base: DecimalVersion): DecimalVersion {
    return bumpMinorTier_op(base);
  }

  private static bumpFixTier(base: DecimalVersion): DecimalVersion {
    return bumpFixTier_op(base);
  }

  private static bumpTinyTier(base: DecimalVersion): DecimalVersion {
    return bumpTinyTier_op(base);
  }

  private static setverToReadmeMajor(readmeMajor: number): DecimalVersion {
    return setverToReadmeMajor_op(readmeMajor);
  }

  private static bumpVer(base: DecimalVersion, tier: BumpTier): DecimalVersion {
    return bumpVer_op(base, tier);
  }

  private static parseSetverDirective(message: string): SetverDirective | null {
    return parseSetverDirective_op(message);
  }

  private static tierFromMsg(message: string): BumpTier | null {
    return tierFromMsg_op(message);
  }

  private static estTokens(str: string): number {
    return estTokens_op(str);
  }

  private static truncateDiff(diff: string, maxChars: number): string {
    return truncateDiff_op(diff, maxChars);
  }

  private static parseTJson(raw: string): { tier: Exclude<BumpTier, "skip">; confidence: number } | null {
    return parseTJson_op(raw);
  }

  private async genTier(message: string, diff: string): Promise<Exclude<BumpTier, "skip">> {
    return genTier_op(this as unknown as TrackerContext, message, diff);
  }

  public async getCommits(
    branch = 'main',
    sinceDays = 7
  ): Promise<Record<RepoIdentifier, RepoHistory>> {
    return getCommits_op(this as unknown as TrackerContext, branch, sinceDays);
  }

  public async rebuildAll(
    branch = 'main',
    commitsPerFile = 250
  ): Promise<Record<RepoIdentifier, RepoHistory[]>> {
    return rebuildAll_op(this as unknown as TrackerContext, branch, commitsPerFile);
  }

  private async getMdVer(repo: RepoIdentifier, branch: string): Promise<{ major: number; readmeSha: string }> {
    return getMdVer_op(this as unknown as TrackerContext, repo, branch);
  }

  private async fetchCommits(
    repo: RepoIdentifier,
    branch: string,
    sinceIso: string,
    versionInfo: { major: number; readmeSha: string },
    stopSha: string
  ): Promise<CommitSummary[]> {
    return fetchCommits_op(this as unknown as TrackerContext, repo, branch, sinceIso, versionInfo, stopSha);
  }

  private async tryReadmeMajorAtSha(repo: RepoIdentifier, sha: string, fallbackMajor: number): Promise<number> {
    return tryReadmeMajorAtSha_op(this as unknown as TrackerContext, repo, sha, fallbackMajor);
  }

  private async fetchDiff(repo: RepoIdentifier, sha: string): Promise<string> {
    return fetchDiff_op(this as unknown as TrackerContext, repo, sha);
  }
}
