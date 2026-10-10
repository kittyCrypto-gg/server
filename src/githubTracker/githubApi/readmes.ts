import fetch from "node-fetch";
import type { RepoIdentifier } from "../types";
import type { TrackerContext } from "../context";

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
