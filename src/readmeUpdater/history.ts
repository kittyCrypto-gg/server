import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { RepoHistory } from './types';

    export function historyFilePattern(owner: string, repo: string): RegExp {
        return new RegExp(`-GithubTracker-${owner}-${repo}\\.json$`);
    }


    export async function getLatestHistoryFile(dataDir: string, getPattern: () => RegExp): Promise<{ file: string; data: RepoHistory } | null> {
        let files: string[] = [];
        try {
            files = await readdir(dataDir);
        } catch {
            return null;
        }

        const pattern = getPattern();
        const matches = files.filter((f) => pattern.test(f));
        if (!matches.length) return null;

        matches.sort();
        const latest = matches[matches.length - 1];
        const jsonPath = path.join(dataDir, latest);

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


    export function latestHistoryVersion(history: RepoHistory): string | null {
        if (!history.commits.length) return null;
        const last = history.commits[history.commits.length - 1];
        const v = (last.version ?? '').trim();
        return v ? v : null;
    }

