import path from 'path';
/* @ts-ignore */
import 'dotenv/config';
import type { RepoIdentifier, RepoHistory, PublishResult, ReadmePublisherOptions } from './readmeUpdater/types';
import { historyFilePattern, getLatestHistoryFile, latestHistoryVersion } from './readmeUpdater/history';
import { fetchGithubReadme, updateGithubReadme } from './readmeUpdater/github';
import { replaceVersionToken } from './readmeUpdater/token';

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
        //const tokenStars = token ? '*'.repeat(token.length) : '(none)';
        //console.log(`[versionTracker] Token for GitHub updates: ${token ? tokenStars : '(none)'}`);
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
        return historyFilePattern(this.owner, repo);
    }
    private async getLatestFile(repo: string): Promise<{ file: string; data: RepoHistory } | null> {
        return await getLatestHistoryFile(this.dataDir, () => this.getHisFilePatt(repo));
    }
    private latestVer(history: RepoHistory): string | null {
        return latestHistoryVersion(history);
    }
    private async fetchReadme(repo: string): Promise<{ sha: string; content: string } | null> {
        return await fetchGithubReadme(this.owner, repo, this.branch, () => this.getHeaders());
    }
    private replaceToken(original: string, version: string): {
        updated: string; changed: boolean; fromToken: string | null; toToken: string
    } {
        return replaceVersionToken(original, version);
    }
    private async updateReadme(repo: string, readmeSha: string, newContent: string): Promise<{
        commitSha: string; newReadmeSha: string
    } | null> {
        return await updateGithubReadme(
            this.owner, repo, this.branch, this.dryRun, this.commitMessage,
            () => this.getHeaders(), readmeSha, newContent
        );
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