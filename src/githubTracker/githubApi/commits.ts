import fetch from "node-fetch";
import type { RepoIdentifier, CommitSummary } from "../types";
import type { TrackerContext } from "../context";

export async function fetchCommits(
    ctx: TrackerContext,
    repo: RepoIdentifier,
    branch: string,
    sinceIso: string,
    versionInfo: { major: number; readmeSha: string },
    stopSha: string
  ): Promise<CommitSummary[]> {
    const items = await ctx.fetchCommItms(repo, branch, sinceIso, stopSha);

    console.log(`[GithubTracker][${ctx.owner}/${repo}] fetched=${items.length}`);

    if (!items.length) return [];

    const summaries: CommitSummary[] = [];

    for (const commitObj of items) {
      const sha = commitObj.sha;
      const author = commitObj.commit.author?.name || '';
      const date = commitObj.commit.author?.date || '';
      const message = commitObj.commit.message || '';
      const htmlUrl = commitObj.html_url || '';

      const diff = await ctx.fetchDiff(repo, sha);
      const commitMajor = await ctx.tryReadmeMajorAtSha(repo, sha, versionInfo.major);

      summaries.push({
        sha,
        author,
        date,
        message,
        url: htmlUrl,
        diff,
        version: `${commitMajor}.0`
      });
    }

    return summaries;
}

export async function fetchDiff(ctx: TrackerContext, repo: RepoIdentifier, sha: string): Promise<string> {
    const diffUrl = `https://api.github.com/repos/${ctx.owner}/${repo}/commits/${sha}`;
    const resp = await fetch(diffUrl, {
      headers: {
        ...ctx.getHeaders(),
        Accept: 'application/vnd.github.v3.diff'
      }
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.log(`[${resp.status}] ${diffUrl}`);
      console.log('Error response:', errorText);
      return '';
    }

    const text = await resp.text();

    if (text.trim() === '') {
      return 'Diff is empty or too large to fetch from GitHub API. It may be truncated or omitted due to size limits. Please see the commit on GitHub for details.';
    }

    return text;
}
