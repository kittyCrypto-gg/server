import fetch from 'node-fetch';
import type { GitHubContentResponse, GitHubUpdateResponse } from './types';

    export async function fetchGithubReadme(owner: string, repo: string, branch: string, headers: () => Record<string, string>): Promise<{ sha: string; content: string } | null> {
        const url =
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/README.md` +
            `?ref=${encodeURIComponent(branch)}`;

        const resp = await fetch(url, { headers: headers() });
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


    export async function updateGithubReadme(
        owner: string,
        repo: string,
        branch: string,
        dryRun: boolean,
        commitMessage: string,
        headers: () => Record<string, string>,
        readmeSha: string,
        newContent: string
    ): Promise<{ commitSha: string; newReadmeSha: string } | null> {
        if (dryRun) {
            return { commitSha: '(dry-run)', newReadmeSha: readmeSha };
        }

        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/README.md`;

        const body = {
            message: commitMessage,
            content: Buffer.from(newContent, 'utf-8').toString('base64'),
            sha: readmeSha,
            branch: branch
        };

        const resp = await fetch(url, {
            method: 'PUT',
            headers: { ...headers(), 'Content-Type': 'application/json' },
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

