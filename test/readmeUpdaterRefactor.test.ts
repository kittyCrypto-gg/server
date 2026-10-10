import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { historyFilePattern, getLatestHistoryFile, latestHistoryVersion } from '../src/readmeUpdater/history';
import { replaceVersionToken } from '../src/readmeUpdater/token';
import { updateGithubReadme } from '../src/readmeUpdater/github';

test('version replacement updates every token and retains the first previous token', () => {
    const input = 'Current ${V12}, historical ${V12.5}, and untouched ${VERSION}.';
    expect(replaceVersionToken(input, '13.1')).toEqual({
        updated: 'Current ${V13.1}, historical ${V13.1}, and untouched ${VERSION}.',
        changed: true,
        fromToken: '${V12}',
        toToken: '${V13.1}'
    });
});

test('version replacement preserves identical and token-free READMEs', () => {
    const same = 'Release ${V2.4}';
    expect(replaceVersionToken(same, '2.4')).toEqual({
        updated: same, changed: false, fromToken: '${V2.4}', toToken: '${V2.4}'
    });
    const none = '# Project without a version token';
    expect(replaceVersionToken(none, '2.4')).toEqual({
        updated: none, changed: false, fromToken: null, toToken: '${V2.4}'
    });
});

test('history lookup selects the latest matching JSON file and final commit version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'readme-history-'));
    const pattern = historyFilePattern('example', 'website');
    try {
        const make = (version: string) => JSON.stringify({
            repo: 'website', createdAt: '2026-10-10',
            commits: [{ sha: 'a', author: 'Kitty', date: '2026-10-10',
                message: 'update', url: '', diff: '', version }]
        });
        await writeFile(join(dir, '2026-10-08-GithubTracker-example-website.json'), make('1.0'));
        await writeFile(join(dir, '2026-10-09-GithubTracker-example-website.json'), make('2.1'));
        await writeFile(join(dir, '2026-10-10-GithubTracker-example-other.json'), make('5.0'));
        const result = await getLatestHistoryFile(dir, pattern);
        expect(result?.file).toBe('2026-10-09-GithubTracker-example-website.json');
        expect(result && latestHistoryVersion(result.data)).toBe('2.1');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('history lookup retains null for missing or invalid JSON files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'readme-bad-history-'));
    const pattern = historyFilePattern('example', 'website');
    try {
        expect(await getLatestHistoryFile(dir, pattern)).toBeNull();
        await writeFile(join(dir, '2026-10-10-GithubTracker-example-website.json'), '{bad json');
        expect(await getLatestHistoryFile(dir, pattern)).toBeNull();
        expect(latestHistoryVersion({ repo: 'website', createdAt: '', commits: [] })).toBeNull();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('README dry-run preserves SHA without loading credentials or sending requests', async () => {
    const result = await updateGithubReadme(
        'example', 'website', 'main', true, '!skip update README',
        () => { throw new Error('headers must not be loaded during dry-run'); },
        'original-readme-sha', 'Replacement README'
    );
    expect(result).toEqual({
        commitSha: '(dry-run)', newReadmeSha: 'original-readme-sha'
    });
});
