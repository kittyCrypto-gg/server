import fetch from 'node-fetch';
import { writeFile, mkdir, access, constants, readdir, readFile } from 'fs/promises';
import path from 'path';
/* @ts-ignore */
import 'dotenv/config';

interface GitHubContentFile {
  sha: string;
  content: string;
  encoding: string;
}

type RepoIdentifier = string;

type CommitSummary = {
  sha: string;
  author: string;
  date: string;
  message: string;
  url: string;
  diff: string;
  version: string; // "major.sub"
};

type RepoHistory = {
  repo: RepoIdentifier;
  createdAt: string;
  commits: CommitSummary[];
};

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

interface GitHubCommit {
  sha: string;
  html_url?: string;
  commit: {
    message: string;
    author?: {
      name?: string;
      date?: string;
    };
  };
}

export class GirhubTracker {
  private owner: string;
  private repos: RepoIdentifier[];
  private outDir: string;
  private githubToken: string | undefined;

  constructor(owner: string, repos: RepoIdentifier | RepoIdentifier[], outDir = './commitsTracker') {
    this.owner = owner;
    this.repos = Array.isArray(repos) ? repos : [repos];
    this.outDir = path.resolve(process.cwd(), outDir);
    this.githubToken = process.env.GITHUB_TOKEN;

    if (!this.githubToken) {
      console.warn('Warning: No GITHUB_TOKEN found in environment. API requests may be severely rate-limited.');
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'GithubTracker'
    };

    if (this.githubToken) headers.Authorization = `token ${this.githubToken}`;
    return headers;
  }

  private async ensureDir(): Promise<void> {
    try {
      await access(this.outDir, constants.F_OK);
      return;
    } catch {
      await mkdir(this.outDir, { recursive: true });
    }
  }

  private getNowStamp(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = pad(now.getMonth() + 1);
    const d = pad(now.getDate());
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    return `${y}${m}${d}-${hh}${mm}${ss}`;
  }

  private getHistoryFilePattern(repo: string): RegExp {
    return new RegExp(`-GithubTracker-${this.owner}-${repo}\\.json$`);
  }

  private async getLatestHistoryFile(repo: string): Promise<{ file: string; data: RepoHistory } | null> {
    try {
      const files = await readdir(this.outDir);
      const pattern = this.getHistoryFilePattern(repo);
      const matches = files.filter(f => pattern.test(f));

      if (!matches.length) return null;

      matches.sort();
      const latest = matches[matches.length - 1];
      const json = await readFile(path.join(this.outDir, latest), 'utf-8');
      return { file: latest, data: JSON.parse(json) as RepoHistory };
    } catch {
      return null;
    }
  }

  private safeDate(value: string | undefined): Date | null {
    if (!value) return null;

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;

    return d;
  }

  private computeSinceIso(fallbackSinceDays: number, lastCommitDate: string | undefined): string {
    const last = this.safeDate(lastCommitDate);

    if (!last) {
      return new Date(Date.now() - fallbackSinceDays * 24 * 60 * 60 * 1000).toISOString();
    }

    // Buffer so the last tracked commit is included even if timestamps are tight.
    const bufferMs = 2 * 60 * 60 * 1000;
    return new Date(last.getTime() - bufferMs).toISOString();
  }

  private parseLinkHeader(linkHeader: string | null): Record<string, string> {
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

  private normaliseCommitItems(raw: unknown): GitHubCommit[] {
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

  private async fetchCommitItemsUntil(
    repo: RepoIdentifier,
    branch: string,
    sinceIso: string,
    stopSha: string
  ): Promise<GitHubCommit[]> {
    const all: GitHubCommit[] = [];
    let page = 1;

    while (true) {
      const url =
        `https://api.github.com/repos/${this.owner}/${repo}/commits` +
        `?sha=${encodeURIComponent(branch)}` +
        `&since=${encodeURIComponent(sinceIso)}` +
        `&per_page=100&page=${page}`;

      const resp = await fetch(url, { headers: this.getHeaders() });

      if (!resp.ok) {
        const errorText = await resp.text();
        console.log(`[${resp.status}] ${url}`);
        console.log('Error response:', errorText);
        return all;
      }

      const raw: unknown = await resp.json();
      const pageItems = this.normaliseCommitItems(raw);

      if (!pageItems.length) return all;

      if (!stopSha) {
        all.push(...pageItems);
      } else {
        const stopIdx = pageItems.findIndex(c => c.sha === stopSha);

        if (stopIdx >= 0) {
          all.push(...pageItems.slice(0, stopIdx + 1));
          return all;
        }

        all.push(...pageItems);
      }

      const links = this.parseLinkHeader(resp.headers.get('link'));
      const hasNext = typeof links.next === 'string' && links.next.length > 0;

      if (!hasNext) return all;

      page += 1;

      // Safety cap to avoid pathological runs.
      if (page > 50) {
        console.warn(
          `[GithubTracker][${this.owner}/${repo}] Stopping pagination after 50 pages. ` +
          `Consider narrowing the window or switching to a compare-based approach.`
        );
        return all;
      }
    }
  }

  public async getCommits(
    branch = 'main',
    sinceDays = 7
  ): Promise<Record<RepoIdentifier, RepoHistory>> {
    await this.ensureDir();
    const results: Record<RepoIdentifier, RepoHistory> = {};

    for (const repo of this.repos) {
      const lastHist = await this.getLatestHistoryFile(repo);

      let lastMajor = 0;
      let lastSub = -1;
      let lastSha = '';
      let lastCommitDate: string | undefined;

      if (lastHist && lastHist.data.commits.length) {
        const lastCommit = lastHist.data.commits[lastHist.data.commits.length - 1];
        const match = /^(\d+)\.(\d+)$/.exec(lastCommit.version);

        if (match) {
          lastMajor = parseInt(match[1], 10);
          lastSub = parseInt(match[2], 10);
        }

        lastSha = lastCommit.sha;
        lastCommitDate = lastCommit.date;
      }

      const sinceIso = this.computeSinceIso(sinceDays, lastCommitDate);
      const versionInfo = await this.getReadmeVersion(repo, branch);

      console.log(
        `[GithubTracker][${this.owner}/${repo}] ` +
        `lastFile=${lastHist?.file ?? '(none)'} ` +
        `lastSha=${lastSha || '(none)'} ` +
        `since=${sinceIso}`
      );

      let commits = await this.fetchCommits(repo, branch, sinceIso, versionInfo, lastSha);
      commits = commits.reverse(); // oldest to newest

      const lastIdx = lastSha ? commits.findIndex(c => c.sha === lastSha) : -1;

      if (lastSha && lastIdx < 0) {
        console.warn(
          `[GithubTracker][${this.owner}/${repo}] lastSha not found in fetched window. ` +
          `This usually means the window is too small, there were > 100 commits and pagination did not reach it, ` +
          `or history was rewritten. Proceeding by treating all fetched commits as new.`
        );
      }

      const startIdx = lastIdx >= 0 ? lastIdx + 1 : 0;
      const newCommits = commits.slice(startIdx);

      if (!newCommits.length) {
        console.log(`[GithubTracker][${this.owner}/${repo}] No new commits detected.`);
        continue;
      }

      // Sub-version bump logic with continuity from the last file.
      let currentMajor: number | null = lastHist ? lastMajor : null;
      let currentSub = lastHist ? lastSub : -1;

      const outCommits: CommitSummary[] = [];

      for (const c of newCommits) {
        const thisMajor = parseInt(c.version.split('.')[0], 10);
        const needsMajorReset = currentMajor === null || thisMajor !== currentMajor;

        if (needsMajorReset) {
          currentMajor = thisMajor;
          currentSub = 0;
        } else {
          currentSub += 1;
        }

        c.version = `${currentMajor}.${currentSub}`;
        outCommits.push(c);
      }

      const nowStamp = this.getNowStamp();
      const fileName = `${nowStamp}-GithubTracker-${this.owner}-${repo}.json`;
      const filePath = path.join(this.outDir, fileName);

      const history: RepoHistory = {
        repo,
        createdAt: new Date().toISOString(),
        commits: outCommits
      };

      await writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
      results[repo] = history;

      console.log(`[GithubTracker][${this.owner}/${repo}] Wrote ${outCommits.length} commits to ${fileName}`);
    }

    return results;
  }

  private async getReadmeVersion(repo: RepoIdentifier, branch: string): Promise<{ major: number; readmeSha: string }> {
    const url = `https://api.github.com/repos/${this.owner}/${repo}/contents/README.md?ref=${encodeURIComponent(branch)}`;
    const resp = await fetch(url, { headers: this.getHeaders() });

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

  private async fetchCommits(
    repo: RepoIdentifier,
    branch: string,
    sinceIso: string,
    versionInfo: { major: number; readmeSha: string },
    stopSha: string
  ): Promise<CommitSummary[]> {
    const items = await this.fetchCommitItemsUntil(repo, branch, sinceIso, stopSha);

    console.log(`[GithubTracker][${this.owner}/${repo}] fetched=${items.length}`);

    if (!items.length) return [];

    const summaries: CommitSummary[] = [];

    for (const commitObj of items) {
      const sha = commitObj.sha;
      const author = commitObj.commit.author?.name || '';
      const date = commitObj.commit.author?.date || '';
      const message = commitObj.commit.message || '';
      const htmlUrl = commitObj.html_url || '';

      const diff = await this.fetchDiff(repo, sha);
      const commitMajor = await this.tryReadmeMajorAtSha(repo, sha, versionInfo.major);

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

  private async tryReadmeMajorAtSha(repo: RepoIdentifier, sha: string, fallbackMajor: number): Promise<number> {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${this.owner}/${repo}/${sha}/README.md`;
      const readmeResp = await fetch(rawUrl, { headers: this.getHeaders() });

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

  private async fetchDiff(repo: RepoIdentifier, sha: string): Promise<string> {
    const diffUrl = `https://api.github.com/repos/${this.owner}/${repo}/commits/${sha}`;
    const resp = await fetch(diffUrl, {
      headers: {
        ...this.getHeaders(),
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
}