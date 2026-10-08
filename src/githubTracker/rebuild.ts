import { writeFile } from "fs/promises";
import path from "path";
import * as versioning from "./versioning";
import type { BumpTier, DecimalPrecision, DecimalVersion, RepoIdentifier, CommitSummary, RepoHistory, SetverDirective, GitHubCommit, LlmTierJson } from "./types";
import type { TrackerContext } from "./context";

export async function rebuildAll(
    ctx: TrackerContext,
    branch = 'main',
    commitsPerFile = 250
  ): Promise<Record<RepoIdentifier, RepoHistory[]>> {
    await ctx.ensureDir();

    const results: Record<RepoIdentifier, RepoHistory[]> = {};

    for (const repo of ctx.repos) {
      console.log(`[GithubTracker][${ctx.owner}/${repo}] Rebuild starting (branch=${branch})`);
      console.log(`[GithubTracker][${ctx.owner}/${repo}] Step 1/3: Fetching full commit list from GitHub API...`);

      const itemsNewestFirst = await ctx.fetchAll(repo, branch);

      console.log(
        `[GithubTracker][${ctx.owner}/${repo}] Step 1/3: Received ${itemsNewestFirst.length} commit(s).`
      );

      if (!itemsNewestFirst.length) {
        console.log(`[GithubTracker][${ctx.owner}/${repo}] No commits found. Nothing to rebuild.`);
        results[repo] = [];
        continue;
      }

      console.log(`[GithubTracker][${ctx.owner}/${repo}] Step 2/3: Reversing list so we replay from oldest to newest...`);

      const items = [...itemsNewestFirst].reverse(); // oldest to newest
      const histories: RepoHistory[] = [];

      let current: DecimalVersion = versioning.parseVer("0.0");
      let lastSeenMajor = 0;

      let pending: CommitSummary[] = [];
      let lastStampUsed: string | null = null;

      const flush = async (stampIso: string): Promise<void> => {
        if (!pending.length) return;

        let stamp = ctx.stampFromIso(stampIso);
        while (lastStampUsed !== null && stamp <= lastStampUsed) {
          stamp = ctx.bumpStampByOneSecond(stamp);
        }

        lastStampUsed = stamp;

        const fileName = `${stamp}-GithubTracker-${ctx.owner}-${repo}.json`;
        const filePath = path.join(ctx.outDir, fileName);

        const history: RepoHistory = {
          repo,
          createdAt: stampIso,
          commits: pending
        };

        console.log(
          `[GithubTracker][${ctx.owner}/${repo}] Flush: writing ${pending.length} commit(s) to ${fileName}...`
        );

        await writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
        histories.push(history);

        console.log(
          `[GithubTracker][${ctx.owner}/${repo}] Flush: wrote ${pending.length} commit(s) to ${fileName}`
        );

        pending = [];
      };

      console.log(
        `[GithubTracker][${ctx.owner}/${repo}] Step 3/3: Replaying ${items.length} commit(s) with versioning...`
      );

      const progressEvery = Math.max(1, Math.floor(items.length / 200)); // about 0.5% updates
      const logMsg = (msg: string): string => {
        const oneLine = msg.replace(/\s+/g, ' ').trim();
        if (oneLine.length <= 120) return oneLine;
        return oneLine.slice(0, 117) + '...';
      };

      for (let i = 0; i < items.length; i += 1) {
        const commitObj = items[i];

        const sha = commitObj.sha;
        const author = commitObj.commit.author?.name || '';
        const date = commitObj.commit.author?.date || '';
        const message = commitObj.commit.message || '';
        const htmlUrl = commitObj.html_url || '';

        const idx = i + 1;
        const pct = ((idx / items.length) * 100).toFixed(1);

        if (i === 0) {
          console.log(
            `[GithubTracker][${ctx.owner}/${repo}] First commit: idx=${idx}/${items.length} (${pct}%) sha=${sha}`
          );
        } else if ((i % progressEvery) === 0) {
          console.log(
            `[GithubTracker][${ctx.owner}/${repo}] Progress: idx=${idx}/${items.length} (${pct}%) currentVersion=${versioning.formatVer(current)}`
          );
        }

        console.log(
          `[GithubTracker][${ctx.owner}/${repo}] Checking commit ${idx}/${items.length} (${pct}%) sha=${sha} ` +
          `date=${date || '(no-date)'} author=${author || '(no-author)'} msg="${logMsg(message)}"`
        );

        console.log(`[GithubTracker][${ctx.owner}/${repo}]   - Fetching diff for ${sha}...`);
        const diff = await ctx.fetchDiff(repo, sha);
        console.log(`[GithubTracker][${ctx.owner}/${repo}]   - Diff fetched (${diff.length} chars).`);

        console.log(`[GithubTracker][${ctx.owner}/${repo}]   - Reading README.md at ${sha} to detect major...`);
        const commitMajor = await ctx.tryReadmeMajorAtSha(repo, sha, lastSeenMajor);

        if (commitMajor > 0 && commitMajor !== lastSeenMajor) {
          console.log(
            `[GithubTracker][${ctx.owner}/${repo}]   - README major changed: ${lastSeenMajor} -> ${commitMajor}`
          );
          lastSeenMajor = commitMajor;
        } else {
          console.log(
            `[GithubTracker][${ctx.owner}/${repo}]   - README major detected: ${commitMajor} (lastSeenMajor=${lastSeenMajor})`
          );
        }

        const before = versioning.formatVer(current);
        const setver = versioning.parseSetverDirective(message);

        let storedVersionOverride: string | null = null;

        if (setver) {
          if (setver.kind === "explicit") {
            console.log(
              `[GithubTracker][${ctx.owner}/${repo}]   - Found !setver explicit override: ${setver.rawVersion} (was ${before})`
            );
            current = versioning.parseVer(setver.rawVersion);
            storedVersionOverride = setver.rawVersion;
          } else {
            if (commitMajor > 0) {
              const nextFromReadme = versioning.setverToReadmeMajor(commitMajor);
              console.log(
                `[GithubTracker][${ctx.owner}/${repo}]   - Found !setver (README major): ${before} -> ${versioning.formatVer(nextFromReadme)}`
              );
              current = nextFromReadme;
            } else {
              console.log(
                `[GithubTracker][${ctx.owner}/${repo}]   - Found !setver but README major not detected, leaving version unchanged (current=${before})`
              );
            }
          }
        } else {
          const taggedTier = versioning.tierFromMsg(message);

          if (taggedTier) {
            console.log(
              `[GithubTracker][${ctx.owner}/${repo}]   - Tier decided from tag: ${taggedTier}`
            );
          } else {
            console.log(
              `[GithubTracker][${ctx.owner}/${repo}]   - No tier tag found. Asking LLM to classify...`
            );
          }

          const tier = taggedTier ?? await ctx.genTier(message, diff);

          if (!taggedTier) {
            console.log(
              `[GithubTracker][${ctx.owner}/${repo}]   - LLM tier: ${tier}`
            );
          }

          const next = versioning.bumpVer(current, tier);

          current = next;
          const after = versioning.formatVer(current);

          console.log(
            `[GithubTracker][${ctx.owner}/${repo}]   - Version bump: ${before} -> ${after} (tier=${tier})`
          );
        }

        const version = storedVersionOverride ?? versioning.formatVer(current);

        pending.push({
          sha,
          author,
          date,
          message,
          url: htmlUrl,
          diff,
          version
        });

        if (pending.length >= commitsPerFile) {
          const stampIso = pending[pending.length - 1]?.date || new Date().toISOString();
          console.log(
            `[GithubTracker][${ctx.owner}/${repo}] Chunk reached ${commitsPerFile} commit(s). Flushing to disk...`
          );
          await flush(stampIso);
        }
      }

      if (pending.length) {
        const stampIso = pending[pending.length - 1]?.date || new Date().toISOString();
        console.log(
          `[GithubTracker][${ctx.owner}/${repo}] Final flush (${pending.length} remaining commit(s))...`
        );
        await flush(stampIso);
      }

      results[repo] = histories;

      console.log(
        `[GithubTracker][${ctx.owner}/${repo}] Rebuild complete. ` +
        `files=${histories.length} commits=${items.length} finalVersion=${versioning.formatVer(current)}`
      );
    }

    return results;
}
