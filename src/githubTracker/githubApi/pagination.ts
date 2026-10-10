import fetch from "node-fetch";
import type { GitHubCommit, RepoIdentifier } from "../types";
import type { TrackerContext } from "../context";

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

      const stopIdx = stopSha ? pageItems.findIndex((c) => c.sha === stopSha) : -1;
      if (stopIdx >= 0) {
        all.push(...pageItems.slice(0, stopIdx + 1));
        return all;
      }
      all.push(...pageItems);

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
