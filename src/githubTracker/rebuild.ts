import * as versioning from "./versioning";
import { replayRebuildCommit } from "./rebuild/replay";
import { createRebuildFlusher } from "./rebuild/storage";
import type { DecimalVersion, RepoIdentifier, CommitSummary, RepoHistory } from "./types";
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
      const flush = createRebuildFlusher(ctx, repo, histories);

      console.log(
        `[GithubTracker][${ctx.owner}/${repo}] Step 3/3: Replaying ${items.length} commit(s) with versioning...`
      );

      const progressEvery = Math.max(1, Math.floor(items.length / 200)); // about 0.5% updates
      for (let i = 0; i < items.length; i += 1) {
        const replayed = await replayRebuildCommit(
          ctx, repo, items[i], i, items.length, progressEvery, current, lastSeenMajor
        );
        current = replayed.current;
        lastSeenMajor = replayed.lastSeenMajor;
        pending.push(replayed.summary);

        if (pending.length >= commitsPerFile) {
          const stampIso = pending[pending.length - 1]?.date || new Date().toISOString();
          console.log(
            `[GithubTracker][${ctx.owner}/${repo}] Chunk reached ${commitsPerFile} commit(s). Flushing to disk...`
          );
          await flush(pending, stampIso);
          pending = [];
        }
      }

      if (pending.length) {
        const stampIso = pending[pending.length - 1]?.date || new Date().toISOString();
        console.log(
          `[GithubTracker][${ctx.owner}/${repo}] Final flush (${pending.length} remaining commit(s))...`
        );
        await flush(pending, stampIso);
        pending = [];
      }

      results[repo] = histories;

      console.log(
        `[GithubTracker][${ctx.owner}/${repo}] Rebuild complete. ` +
        `files=${histories.length} commits=${items.length} finalVersion=${versioning.formatVer(current)}`
      );
    }

    return results;
}
