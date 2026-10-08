import fetch from "node-fetch";
import type { BumpTier, DecimalPrecision, DecimalVersion, RepoIdentifier, CommitSummary, RepoHistory, SetverDirective, GitHubCommit, LlmTierJson } from "./types";
import type { TrackerContext } from "./context";

export function getHeaders(ctx: TrackerContext): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'GithubTracker'
    };

    if (ctx.githubToken) headers.Authorization = `token ${ctx.githubToken}`;
    return headers;
}

export function parseLink(ctx: TrackerContext, linkHeader: string | null): Record<string, string> {
    if (!linkHeader) return {};

    const links: Record<string, string> = {};
    const parts = linkHeader.split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      const match = /<([^>]+)>;\s*rel="([^"]+)"/.exec(trimmed);
      if (!match) continue;
      links[match[2]] = match[1];
    }

    return links;
}

export function normCommItems(ctx: TrackerContext, raw: unknown): GitHubCommit[] {
    if (!Array.isArray(raw)) return [];

    const items: GitHubCommit[] = [];

    for (const el of raw) {
      if (typeof el !== 'object' || el === null) continue;

      const r = el as Record<string, unknown>;
      if (typeof r.sha !== 'string') continue;

      if (typeof r.commit !== 'object' || r.commit === null) continue;

      const commit = r.commit as Record<string, unknown>;
      const message = typeof commit.message === 'string' ? commit.message : '';

      const authorObj = typeof commit.author === 'object' && commit.author !== null
        ? (commit.author as Record<string, unknown>)
        : undefined;

      const authorName = authorObj && typeof authorObj.name === 'string' ? authorObj.name : '';
      const authorDate = authorObj && typeof authorObj.date === 'string' ? authorObj.date : '';

      items.push({
        sha: r.sha,
        html_url: typeof r.html_url === 'string' ? r.html_url : undefined,
        commit: {
          message,
          author: { name: authorName, date: authorDate }
        }
      });
    }

    return items;
}

export async function fetchCommItms(
    ctx: TrackerContext,
    repo: RepoIdentifier,
    branch: string,
    sinceIso: string,
    stopSha: string
  ): Promise<GitHubCommit[]> {
    const all: GitHubCommit[] = [];
    let page = 1;

    while (true) {
      const url =
        `https://api.github.com/repos/${ctx.owner}/${repo}/commits` +
        `?sha=${encodeURIComponent(branch)}` +
        `&since=${encodeURIComponent(sinceIso)}` +
        `&per_page=100&page=${page}`;

      const resp = await fetch(url, { headers: ctx.getHeaders() });

      if (!resp.ok) {
        const errorText = await resp.text();
        console.log(`[${resp.status}] ${url}`);
        console.log('Error response:', errorText);
        return all;
      }

      const raw: unknown = await resp.json();
      const pageItems = ctx.normCommItems(raw);

      if (!pageItems.length) return all;

      if (!stopSha) {
        all.push(...pageItems);
      } else {
        const stopIdx = pageItems.findIndex((c) => c.sha === stopSha);

        if (stopIdx >= 0) {
          all.push(...pageItems.slice(0, stopIdx + 1));
          return all;
        }

        all.push(...pageItems);
      }

      const links = ctx.parseLink(resp.headers.get('link'));
      const hasNext = typeof links.next === 'string' && links.next.length > 0;

      if (!hasNext) return all;

      page += 1;

      if (page > 50) {
        console.warn(
          `[GithubTracker][${ctx.owner}/${repo}] Stopping pagination after 50 pages. ` +
          `Consider narrowing the window or switching to a compare-based approach.`
        );
        return all;
      }
    }
}

export async function fetchAll(
    ctx: TrackerContext,
    repo: RepoIdentifier,
    branch: string
  ): Promise<GitHubCommit[]> {
    const all: GitHubCommit[] = [];
    let page = 1;

    while (true) {
      const url =
        `https://api.github.com/repos/${ctx.owner}/${repo}/commits` +
        `?sha=${encodeURIComponent(branch)}` +
        `&per_page=100&page=${page}`;

      const resp = await fetch(url, { headers: ctx.getHeaders() });

      if (!resp.ok) {
        const errorText = await resp.text();
        console.log(`[${resp.status}] ${url}`);
        console.log('Error response:', errorText);
        return all;
      }

      const raw: unknown = await resp.json();
      const pageItems = ctx.normCommItems(raw);

      if (!pageItems.length) return all;

      all.push(...pageItems);

      const links = ctx.parseLink(resp.headers.get('link'));
      const hasNext = typeof links.next === 'string' && links.next.length > 0;

      if (!hasNext) return all;

      page += 1;

      if (page > 500) {
        console.warn(
          `[GithubTracker][${ctx.owner}/${repo}] Stopping pagination after 500 pages. ` +
          `This is a safety cap for rebuild runs.`
        );
        return all;
      }
    }
}

export async function getMdVer(ctx: TrackerContext, repo: RepoIdentifier, branch: string): Promise<{ major: number; readmeSha: string }> {
    const url = `https://api.github.com/repos/${ctx.owner}/${repo}/contents/README.md?ref=${encodeURIComponent(branch)}`;
    const resp = await fetch(url, { headers: ctx.getHeaders() });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.log(`[${resp.status}] ${url}`);
      console.log('Error response:', errorText);
      return { major: 0, readmeSha: '' };
    }

    const raw: unknown = await resp.json();

    if (typeof raw !== 'object' || raw === null) return { major: 0, readmeSha: '' };

    const obj = raw as Record<string, unknown>;
    if (typeof obj.content !== 'string' || typeof obj.sha !== 'string') return { major: 0, readmeSha: '' };

    const content = Buffer.from(obj.content, 'base64').toString('utf-8');
    const match = content.match(/\$\{V(\d+)\}/);
    const major = match ? parseInt(match[1], 10) : 0;

    return { major, readmeSha: obj.sha };
}

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

export async function tryReadmeMajorAtSha(ctx: TrackerContext, repo: RepoIdentifier, sha: string, fallbackMajor: number): Promise<number> {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${ctx.owner}/${repo}/${sha}/README.md`;
      const readmeResp = await fetch(rawUrl, { headers: ctx.getHeaders() });

      if (!readmeResp.ok) return fallbackMajor;

      const content = await readmeResp.text();
      const match = content.match(/\$\{V(\d+)\}/);

      if (!match) return fallbackMajor;

      const parsed = parseInt(match[1], 10);
      return Number.isNaN(parsed) ? fallbackMajor : parsed;
    } catch {
      return fallbackMajor;
    }
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
