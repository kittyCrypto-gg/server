import { writeFile } from "fs/promises";
import path from "path";
import * as versioning from "./versioning";
import type { BumpTier, DecimalPrecision, DecimalVersion, RepoIdentifier, CommitSummary, RepoHistory, SetverDirective, GitHubCommit, LlmTierJson } from "./types";
import type { TrackerContext } from "./context";

export async function getCommits(
    ctx: TrackerContext,
    branch = 'main',
    sinceDays = 7
  ): Promise<Record<RepoIdentifier, RepoHistory>> {
    await ctx.ensureDir();
    const results: Record<RepoIdentifier, RepoHistory> = {};

    for (const repo of ctx.repos) {
      const lastHist = await ctx.getLatestHistoryFile(repo);

      let lastSha = '';
      let lastCommitDate: string | undefined;
      let baseVersionStr: string | null = null;

      if (lastHist && lastHist.data.commits.length) {
        const lastCommit = lastHist.data.commits[lastHist.data.commits.length - 1];
        lastSha = lastCommit.sha;
        lastCommitDate = lastCommit.date;
        baseVersionStr = lastCommit.version;
      }

      const sinceIso = ctx.compSince(sinceDays, lastCommitDate);
      const versionInfo = await ctx.getMdVer(repo, branch);

      const baseFromReadme = `${versionInfo.major}.0`;
      let current = versioning.parseVer(baseVersionStr ?? baseFromReadme);

      console.log(
        `[GithubTracker][${ctx.owner}/${repo}] ` +
        `lastFile=${lastHist?.file ?? '(none)'} ` +
        `lastSha=${lastSha || '(none)'} ` +
        `since=${sinceIso} ` +
        `base=${versioning.formatVer(current)}`
      );

      let commits = await ctx.fetchCommits(repo, branch, sinceIso, versionInfo, lastSha);
      commits = commits.reverse(); // oldest to newest

      const lastIdx = lastSha ? commits.findIndex((c) => c.sha === lastSha) : -1;

      if (lastSha && lastIdx < 0) {
        console.warn(
          `[GithubTracker][${ctx.owner}/${repo}] lastSha not found in fetched window. ` +
          `This usually means the window is too small, there were > 100 commits and pagination did not reach it, ` +
          `or history was rewritten. Proceeding by treating all fetched commits as new.`
        );
      }

      const startIdx = lastIdx >= 0 ? lastIdx + 1 : 0;
      const newCommits = commits.slice(startIdx);

      if (!newCommits.length) {
        console.log(`[GithubTracker][${ctx.owner}/${repo}] No new commits detected.`);
        continue;
      }

      const outCommits: CommitSummary[] = [];

      for (const c of newCommits) {
        const commitReadmeMajor = versioning.parseVer(c.version).major;

        const setver = versioning.parseSetverDirective(c.message);
        if (setver) {
          if (setver.kind === "explicit") {
            current = versioning.parseVer(setver.rawVersion);
            c.version = setver.rawVersion; // store exactly what was typed
            outCommits.push(c);
            continue;
          }

          if (commitReadmeMajor > 0) {
            current = versioning.setverToReadmeMajor(commitReadmeMajor);
          }

          c.version = versioning.formatVer(current);
          outCommits.push(c);
          continue;
        }

        const taggedTier = versioning.tierFromMsg(c.message);
        const tier = taggedTier ?? await ctx.genTier(c.message, c.diff);

        const next = versioning.bumpVer(current, tier);
        current = next;

        c.version = versioning.formatVer(current);
        outCommits.push(c);
      }

      const nowStamp = ctx.getNow();
      const fileName = `${nowStamp}-GithubTracker-${ctx.owner}-${repo}.json`;
      const filePath = path.join(ctx.outDir, fileName);

      const history: RepoHistory = {
        repo,
        createdAt: new Date().toISOString(),
        commits: outCommits
      };

      await writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
      results[repo] = history;

      console.log(`[GithubTracker][${ctx.owner}/${repo}] Wrote ${outCommits.length} commits to ${fileName}`);
    }

    return results;
}
