import fetch from 'node-fetch';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

/* @ts-ignore */
import 'dotenv/config';

type RepoIdentifier = string;

type CommitSummary = {
    sha: string;
    author: string;
    date: string;
    message: string;
    url: string;
    diff: string;
    version: string;
};

type RepoHistory = {
    repo: RepoIdentifier;
    createdAt: string;
    commits: CommitSummary[];
};

type PublishResult =
    | { kind: 'skipped'; repo: RepoIdentifier; reason: string }
    | { kind: 'updated'; repo: RepoIdentifier; from: string; to: string; commitSha: string; readmeSha: string };

type GitHubContentResponse = {
    sha: string;
    content: string; // base64
    encoding: 'base64';
};

type GitHubUpdateResponse = {
    content?: { sha?: string };
    commit?: { sha?: string };
};

type ReadmePublisherOptions = {
    outDirName?: string;

    branch?: string;

    dryRun?: boolean;

    commitMessage?: string;
};

export class versionTracker {
    private owner: string;
    private repos: RepoIdentifier[];
    private dataDir: string;
    private branch: string;
    private dryRun: boolean;
    private commitMessage: string;
    private githubWriteToken: string;

    constructor(
        owner: string,
        repos: RepoIdentifier | RepoIdentifier[],
        options: ReadmePublisherOptions = {}
    ) {
        this.owner = owner;
        this.repos = Array.isArray(repos) ? repos : [repos];

        const outDirName = options.outDirName ?? 'commitsTracker';
        this.dataDir = path.resolve(process.cwd(), 'data', outDirName);

        this.branch = options.branch ?? 'main';
        this.dryRun = options.dryRun ?? false;
        this.commitMessage = options.commitMessage ?? '!skip chore: update README version token';

        const token = process.env.GITHUB_README_TOKEN ?? '';
        // match * with the numner of chars shown in the token so if token is 6 chars show 6 *  and if token is 40 chars show 40 *
        const tokenStars = token ? '*'.repeat(token.length) : '(none)';
        console.log(`[versionTracker] Token for GitHub updates: ${token ? tokenStars : '(none)'}`);
        if (!token) {
            throw new Error(
                '[ReadmeVersionPublisher] Missing GITHUB_README_TOKEN in environment. ' +
                'Provide a write-capable GitHub token with permission to update repo contents.'
            );
        }
        this.githubWriteToken = token;
    }

    private getHeaders(): Record<string, string> {
        return {
            'User-Agent': 'ReadmeVersionPublisher',
            Authorization: `Bearer ${this.githubWriteToken}`,
            Accept: 'application/vnd.github+json'
        };
    }

    private getHisFilePatt(repo: string): RegExp {
        return new RegExp(`-GithubTracker-${this.owner}-${repo}\\.json$`);
    }

    private async getLatestFile(repo: string): Promise<{ file: string; data: RepoHistory } | null> {
        let files: string[] = [];
        try {
            files = await readdir(this.dataDir);
        } catch {
            return null;
        }

        const pattern = this.getHisFilePatt(repo);
        const matches = files.filter((f) => pattern.test(f));
        if (!matches.length) return null;

        matches.sort();
        const latest = matches[matches.length - 1];
        const jsonPath = path.join(this.dataDir, latest);

        let json = '';
        try {
            json = await readFile(jsonPath, 'utf-8');
        } catch {
            return null;
        }

        try {
            const parsed = JSON.parse(json) as RepoHistory;
            return { file: latest, data: parsed };
        } catch {
            return null;
        }
    }

    private latestVer(history: RepoHistory): string | null {
        if (!history.commits.length) return null;
        const last = history.commits[history.commits.length - 1];
        const v = (last.version ?? '').trim();
        return v ? v : null;
    }

    private async fetchReadme(repo: string): Promise<{ sha: string; content: string } | null> {
        const url =
            `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(repo)}/contents/README.md` +
            `?ref=${encodeURIComponent(this.branch)}`;

        const resp = await fetch(url, { headers: this.getHeaders() });
        if (!resp.ok) return null;

        const raw = (await resp.json()) as unknown;
        if (typeof raw !== 'object' || raw === null) return null;

        const obj = raw as Partial<GitHubContentResponse>;
        if (typeof obj.sha !== 'string') return null;
        if (typeof obj.content !== 'string') return null;
        if (obj.encoding !== 'base64') return null;

        const decoded = Buffer.from(obj.content, 'base64').toString('utf-8');
        return { sha: obj.sha, content: decoded };
    }

    private replaceToken(
        original: string,
        version: string
    ): { updated: string; changed: boolean; fromToken: string | null; toToken: string } {
        // Find first occurrence like ${V12} and replace ALL occurrences to ${V<version>}
        const tokenRe = /\$\{V(\d+(?:\.\d+)?)\}/g;

        let firstFrom: string | null = null;
        const updated = original.replace(tokenRe, (m) => {
            if (!firstFrom) firstFrom = m;
            return `\${V${version}}`;
        });

        const changed = updated !== original;
        return { updated, changed, fromToken: firstFrom, toToken: `\${V${version}}` };
    }

    private async updateReadme(
        repo: string,
        readmeSha: string,
        newContent: string
    ): Promise<{ commitSha: string; newReadmeSha: string } | null> {
        if (this.dryRun) {
            return { commitSha: '(dry-run)', newReadmeSha: readmeSha };
        }

        const url = `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(repo)}/contents/README.md`;

        const body = {
            message: this.commitMessage,
            content: Buffer.from(newContent, 'utf-8').toString('base64'),
            sha: readmeSha,
            branch: this.branch
        };

        const resp = await fetch(url, {
            method: 'PUT',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!resp.ok) return null;

        const raw = (await resp.json()) as unknown;
        if (typeof raw !== 'object' || raw === null) return null;

        const obj = raw as GitHubUpdateResponse;
        const commitSha = obj.commit?.sha ?? '';
        const newReadmeSha = obj.content?.sha ?? '';

        if (!commitSha || !newReadmeSha) return null;
        return { commitSha, newReadmeSha };
    }

    public async publish(): Promise<PublishResult[]> {
        const results: PublishResult[] = [];

        for (const repo of this.repos) {
            const latest = await this.getLatestFile(repo);
            if (!latest) {
                results.push({ kind: 'skipped', repo, reason: `No history JSON found in ${this.dataDir}` });
                continue;
            }

            const version = this.latestVer(latest.data);
            if (!version) {
                results.push({ kind: 'skipped', repo, reason: 'History JSON had no commits or no version' });
                continue;
            }

            const readme = await this.fetchReadme(repo);
            if (!readme) {
                results.push({ kind: 'skipped', repo, reason: `README.md not found on branch ${this.branch} (or no access)` });
                continue;
            }

            const replaced = this.replaceToken(readme.content, version);
            if (!replaced.changed) {
                const reason = replaced.fromToken
                    ? `README already has ${replaced.toToken}, no update needed`
                    : 'No version token found in README to replace';
                results.push({ kind: 'skipped', repo, reason: reason });
                continue;
            }

            const updated = await this.updateReadme(repo, readme.sha, replaced.updated);
            if (!updated) {
                results.push({ kind: 'skipped', repo, reason: 'GitHub update failed (check token permissions / branch protection)' });
                continue;
            }

            results.push({
                kind: 'updated',
                repo,
                from: replaced.fromToken ?? '${V?}',
                to: replaced.toToken,
                commitSha: updated.commitSha,
                readmeSha: updated.newReadmeSha
            });
        }

        return results;
    }
}