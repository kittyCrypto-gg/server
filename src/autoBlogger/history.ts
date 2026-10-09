import * as fs from "fs/promises";
import path from "path";
import type { OpenAIAPIErrorShape, ModeratorStrings, CommitEntry, BritishSpellcheckChunkResponse, LineChange, CommitLog } from "./types";
import type { BloggerContext } from "./context";

export async function ensureDir(ctx: BloggerContext, dir: string): Promise<void> {
    try {
      await fs.access(dir, fs.constants.F_OK);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
}

export async function getLatestJson(ctx: BloggerContext): Promise<{ file: string, json: CommitLog } | null> {
    const pattern = new RegExp(`-GithubTracker-${ctx.owner}-${ctx.repo}\\.json$`);
    const files = await fs.readdir(ctx.commitsDir);
    const matches = files.filter(f => pattern.test(f));

    if (!matches.length) return null;

    matches.sort();
    const latest = matches[matches.length - 1];
    const content = await fs.readFile(path.join(ctx.commitsDir, latest), 'utf-8');
    return { file: latest, json: JSON.parse(content) as CommitLog };
}
