import fetch from 'node-fetch';
import { writeFile, mkdir, access, constants, readdir, readFile } from 'fs/promises';
import path from 'path';

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

function pad(n: number): string { return n.toString().padStart(2, '0'); }

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
    const headers: Record<string, string> = {};
    if (this.githubToken) headers.Authorization = `token ${this.githubToken}`;
    return headers;
  }

  private async ensureDir() {
    try { await access(this.outDir, constants.F_OK); }
    catch { await mkdir(this.outDir, { recursive: true }); }
  }

  private getNowStamp() {
    const now = new Date();
    const y = now.getFullYear();
    const m = pad(now.getMonth() + 1);
    const d = pad(now.getDate());
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    return `${y}${m}${d}-${hh}${mm}${ss}`;
  }

  private getHistoryFilePattern(repo: string) {
    return new RegExp(`-GithubTracker-${this.owner}-${repo}\\.json$`);
  }

  private async getLatestHistoryFile(repo: string): Promise<{ file: string, data: RepoHistory } | null> {
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

  public async getCommits(
    branch = 'main',
    sinceDays = 7
  ): Promise<Record<RepoIdentifier, RepoHistory>> {
    await this.ensureDir();
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    const results: Record<RepoIdentifier, RepoHistory> = {};

    for (const repo of this.repos) {
      const versionInfo = await this.getReadmeVersion(repo, branch);
      let commits = await this.fetchCommits(repo, branch, since, versionInfo);
      commits = commits.reverse(); // oldest to newest

      // --- Find last log for sub-version tracking ---
      const lastHist = await this.getLatestHistoryFile(repo);
      let lastMajor = versionInfo.major;
      let subVersion = 0;
      let lastSha = '';
      if (lastHist && lastHist.data.commits.length) {
        const lastCommit = lastHist.data.commits[lastHist.data.commits.length - 1];
        const match = /^(\d+)\.(\d+)$/.exec(lastCommit.version);
        if (match) {
          lastMajor = parseInt(match[1], 10);
          subVersion = parseInt(match[2], 10);
        }
        lastSha = lastCommit.sha;
      }

      // --- Only include new commits ---
      const startIdx = lastSha
        ? commits.findIndex(c => c.sha === lastSha) + 1
        : 0;
      if (startIdx < 0 || startIdx >= commits.length) continue;

      // --- Sub-version bump logic ---
      let currentMajor = lastMajor;
      let currentSub = subVersion;
      let bump = false;
      const outCommits: CommitSummary[] = [];
      for (let i = startIdx; i < commits.length; ++i) {
        const c = commits[i];
        const thisMajor = parseInt(c.version.split('.')[0], 10);

        // Version bump? If so, reset sub-version, else increment
        if (thisMajor !== currentMajor) {
          currentMajor = thisMajor;
          currentSub = 0;
          bump = true;
        } else {
          currentSub = bump ? 0 : currentSub + 1;
          bump = false;
        }
        c.version = `${currentMajor}.${currentSub}`;
        outCommits.push(c);
      }

      // --- Write a file if there are new commits ---
      if (outCommits.length > 0) {
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
      }
    }

    return results;
  }

  private async getReadmeVersion(repo: RepoIdentifier, branch: string): Promise<{ major: number; readmeSha: string }> {
    const url = `https://api.github.com/repos/${this.owner}/${repo}/contents/README.md?ref=${branch}`;
    const resp = await fetch(url, { headers: this.getHeaders() });
    if (!resp.ok) {
      const errorText = await resp.text();
      console.log(`[${resp.status}] ${url}`);
      console.log('Error response:', errorText);
      return { major: 0, readmeSha: '' };
    }
    const data = await resp.json();
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    const match = content.match(/\$\{V(\d+)\}/);
    const major = match ? parseInt(match[1], 10) : 0;
    return { major, readmeSha: data.sha };
  }

  private async fetchCommits(
    repo: RepoIdentifier,
    branch: string,
    since: string,
    versionInfo: { major: number; readmeSha: string }
  ): Promise<CommitSummary[]> {
    const url = `https://api.github.com/repos/${this.owner}/${repo}/commits?sha=${branch}&since=${since}&per_page=100`;
    const resp = await fetch(url, { headers: this.getHeaders() });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.log(`[${resp.status}] ${url}`);
      console.log('Error response:', errorText);
      return [];
    }

    const data = (await resp.json()) as any[];
    if (!Array.isArray(data) || data.length === 0) return [];

    const summaries: CommitSummary[] = [];
    let major = versionInfo.major;
    for (let i = 0; i < data.length; ++i) {
      const commitObj = data[i];
      const sha = commitObj.sha;
      const author = commitObj.commit.author?.name || '';
      const date = commitObj.commit.author?.date || '';
      const message = commitObj.commit.message || '';
      const html_url = commitObj.html_url || '';
      const diff = await this.fetchDiff(repo, sha);

      // check for version bump in this commit's readme
      let commitMajor = major;
      try {
        const rawUrl = `https://raw.githubusercontent.com/${this.owner}/${repo}/${sha}/README.md`;
        const readmeResp = await fetch(rawUrl, { headers: this.getHeaders() });
        if (readmeResp.ok) {
          const content = await readmeResp.text();
          const match = content.match(/\$\{V(\d+)\}/);
          if (match) {
            commitMajor = parseInt(match[1], 10);
          }
        }
      } catch {}
      summaries.push({
        sha,
        author,
        date,
        message,
        url: html_url,
        diff,
        version: `${commitMajor}.0`
      });
      major = commitMajor;
    }
    return summaries;
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

// Example usage:

// const tracker = new GirhubTracker('KittyCrypto-gg', ['kittyServer', 'kittycrypto']);
// tracker.getCommits('main', 7).then(() => {
//   console.log('Done');
// });