import * as versioning from "../versioning";
import type { CommitSummary, DecimalVersion, GitHubCommit, RepoIdentifier } from "../types";
import type { TrackerContext } from "../context";

export type RebuildReplayResult = {
    summary: CommitSummary;
    current: DecimalVersion;
    lastSeenMajor: number;
};

const logMsg = (msg: string): string => {
  const oneLine = msg.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= 120) return oneLine;
  return oneLine.slice(0, 117) + '...';
};

export async function replayRebuildCommit(
    ctx: TrackerContext,
    repo: RepoIdentifier,
    commitObj: GitHubCommit,
    i: number,
    total: number,
    progressEvery: number,
    current: DecimalVersion,
    lastSeenMajor: number,
): Promise<RebuildReplayResult> {
    const sha = commitObj.sha;
    const author = commitObj.commit.author?.name || '';
    const date = commitObj.commit.author?.date || '';
    const message = commitObj.commit.message || '';
    const htmlUrl = commitObj.html_url || '';

    const idx = i + 1;
    const pct = ((idx / total) * 100).toFixed(1);

    if (i === 0) {
      console.log(
        `[GithubTracker][${ctx.owner}/${repo}] First commit: idx=${idx}/${total} (${pct}%) sha=${sha}`
      );
    }
    if (i !== 0 && (i % progressEvery) === 0) {
      console.log(
        `[GithubTracker][${ctx.owner}/${repo}] Progress: idx=${idx}/${total} (${pct}%) currentVersion=${versioning.formatVer(current)}`
      );
    }

    console.log(
      `[GithubTracker][${ctx.owner}/${repo}] Checking commit ${idx}/${total} (${pct}%) sha=${sha} ` +
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

    if (setver?.kind === "explicit") {
      console.log(
        `[GithubTracker][${ctx.owner}/${repo}]   - Found !setver explicit override: ${setver.rawVersion} (was ${before})`
      );
      current = versioning.parseVer(setver.rawVersion);
      storedVersionOverride = setver.rawVersion;
    }

    if (setver?.kind === "readmeMajor" && commitMajor > 0) {
      const nextFromReadme = versioning.setverToReadmeMajor(commitMajor);
      console.log(
        `[GithubTracker][${ctx.owner}/${repo}]   - Found !setver (README major): ${before} -> ${versioning.formatVer(nextFromReadme)}`
      );
      current = nextFromReadme;
    }

    if (setver?.kind === "readmeMajor" && commitMajor <= 0) {
      console.log(
        `[GithubTracker][${ctx.owner}/${repo}]   - Found !setver but README major not detected, leaving version unchanged (current=${before})`
      );
    }

    const taggedTier = !setver ? versioning.tierFromMsg(message) : null;
    if (!setver && taggedTier) {
      console.log(
        `[GithubTracker][${ctx.owner}/${repo}]   - Tier decided from tag: ${taggedTier}`
      );
    }
    if (!setver && !taggedTier) {
      console.log(
        `[GithubTracker][${ctx.owner}/${repo}]   - No tier tag found. Asking LLM to classify...`
      );
    }

    const tier = !setver ? (taggedTier ?? await ctx.genTier(message, diff)) : null;
    if (!setver && !taggedTier) {
      console.log(
        `[GithubTracker][${ctx.owner}/${repo}]   - LLM tier: ${tier}`
      );
    }
    if (!setver && tier !== null) {
      const next = versioning.bumpVer(current, tier);
      current = next;
      const after = versioning.formatVer(current);
      console.log(
        `[GithubTracker][${ctx.owner}/${repo}]   - Version bump: ${before} -> ${after} (tier=${tier})`
      );
    }

    const version = storedVersionOverride ?? versioning.formatVer(current);

    return {
        summary: { sha, author, date, message, url: htmlUrl, diff, version },
        current,
        lastSeenMajor
    };
}
