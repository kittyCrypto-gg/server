import type { GitHubCommit } from "../types";
import type { TrackerContext } from "../context";

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
