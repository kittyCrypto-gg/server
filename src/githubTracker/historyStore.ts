import { mkdir, access, constants, readdir, readFile } from "fs/promises";
import path from "path";
import type { BumpTier, DecimalPrecision, DecimalVersion, RepoIdentifier, CommitSummary, RepoHistory, SetverDirective, GitHubCommit, LlmTierJson } from "./types";
import type { TrackerContext } from "./context";
function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export async function ensureDir(ctx: TrackerContext): Promise<void> {
    try {
      await access(ctx.outDir, constants.F_OK);
      return;
    } catch {
      await mkdir(ctx.outDir, { recursive: true });
    }
}

export function getNow(ctx: TrackerContext): string {
    const now = new Date();
    return ctx.stampFromDate(now);
}

export function stampFromDate(ctx: TrackerContext, d: Date): string {
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${y}${m}${day}-${hh}${mm}${ss}`;
}

export function stampFromIso(ctx: TrackerContext, iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return ctx.getNow();
    return ctx.stampFromDate(d);
}

export function bumpStampByOneSecond(ctx: TrackerContext, stamp: string): string {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
    if (!m) return ctx.getNow();

    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const hh = parseInt(m[4], 10);
    const mm = parseInt(m[5], 10);
    const ss = parseInt(m[6], 10);

    const dt = new Date(y, mo, d, hh, mm, ss);
    dt.setSeconds(dt.getSeconds() + 1);
    return ctx.stampFromDate(dt);
}

export function getHistoryFilePattern(ctx: TrackerContext, repo: string): RegExp {
    return new RegExp(`-GithubTracker-${ctx.owner}-${repo}\\.json$`);
}

export async function getLatestHistoryFile(ctx: TrackerContext, repo: string): Promise<{ file: string; data: RepoHistory } | null> {
    try {
      const files = await readdir(ctx.outDir);
      const pattern = ctx.getHistoryFilePattern(repo);
      const matches = files.filter((f) => pattern.test(f));

      if (!matches.length) return null;

      matches.sort();
      const latest = matches[matches.length - 1];
      const jsonPath = path.join(ctx.outDir, latest);
      const json = await readFile(jsonPath, 'utf-8');
      return { file: latest, data: JSON.parse(json) as RepoHistory };
    } catch {
      return null;
    }
}

export function safeDate(ctx: TrackerContext, value: string | undefined): Date | null {
    if (!value) return null;

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;

    return d;
}

export function compSince(ctx: TrackerContext, fallbackSinceDays: number, lastCommitDate: string | undefined): string {
    const last = ctx.safeDate(lastCommitDate);

    if (!last) {
      return new Date(Date.now() - fallbackSinceDays * 24 * 60 * 60 * 1000).toISOString();
    }

    const bufferMs = 2 * 60 * 60 * 1000;
    return new Date(last.getTime() - bufferMs).toISOString();
}
