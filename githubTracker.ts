import fetch from 'node-fetch';
import { writeFile, mkdir, access, constants, readdir, readFile } from 'fs/promises';
import path from 'path';
import { OpenAI } from "openai";
/* @ts-ignore */
import 'dotenv/config';

type BumpTier =
  | "skip"
  | "major"
  | "feat"
  | "fix"
  | "refactor"
  | "tiny";

type DecimalVersion = {
  major: number;
  digits: [number, number, number, number, number, number]; // decimal places, left-to-right
};

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
  version: string; // decimal version string, e.g. "2.10", "2.235", "2.100001"
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

type LlmTierJson = {
  tier: "major" | "feat" | "fix" | "refactor" | "tiny";
  confidence: number;
};

export class GirhubTracker {
  private owner: string;
  private repos: RepoIdentifier[];
  private outDir: string;
  private githubToken: string | undefined;
  private openai: OpenAI | null;

  constructor(
    owner: string,
    repos: RepoIdentifier | RepoIdentifier[],
    outDir = './commitsTracker',
    openai?: OpenAI
  ) {
    this.owner = owner;
    this.repos = Array.isArray(repos) ? repos : [repos];
    this.outDir = path.resolve(process.cwd(), outDir);
    this.githubToken = process.env.GITHUB_TOKEN;

    const apiKey = process.env.OPENAI_KEY || "";
    this.openai = openai ?? (apiKey ? new OpenAI({ apiKey }) : null);

    if (!this.githubToken) {
      console.warn('Warning: No GITHUB_TOKEN found in environment. API requests may be severely rate-limited.');
    }

    if (!this.openai) {
      console.warn('Warning: No OPENAI_KEY found (and no OpenAI client provided). Untagged commits will default to !tiny.');
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
    return this.stampFromDate(now);
  }

  private stampFromDate(d: Date): string {
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${y}${m}${day}-${hh}${mm}${ss}`;
  }

  private stampFromIso(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return this.getNowStamp();
    return this.stampFromDate(d);
  }

  private bumpStampByOneSecond(stamp: string): string {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
    if (!m) return this.getNowStamp();

    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const hh = parseInt(m[4], 10);
    const mm = parseInt(m[5], 10);
    const ss = parseInt(m[6], 10);

    const dt = new Date(y, mo, d, hh, mm, ss);
    dt.setSeconds(dt.getSeconds() + 1);
    return this.stampFromDate(dt);
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

      if (page > 50) {
        console.warn(
          `[GithubTracker][${this.owner}/${repo}] Stopping pagination after 50 pages. ` +
          `Consider narrowing the window or switching to a compare-based approach.`
        );
        return all;
      }
    }
  }

  private async fetchAllCommitItems(
    repo: RepoIdentifier,
    branch: string
  ): Promise<GitHubCommit[]> {
    const all: GitHubCommit[] = [];
    let page = 1;

    while (true) {
      const url =
        `https://api.github.com/repos/${this.owner}/${repo}/commits` +
        `?sha=${encodeURIComponent(branch)}` +
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

      all.push(...pageItems);

      const links = this.parseLinkHeader(resp.headers.get('link'));
      const hasNext = typeof links.next === 'string' && links.next.length > 0;

      if (!hasNext) return all;

      page += 1;

      if (page > 500) {
        console.warn(
          `[GithubTracker][${this.owner}/${repo}] Stopping pagination after 500 pages. ` +
          `This is a safety cap for rebuild runs.`
        );
        return all;
      }
    }
  }

  private static clampDigit(n: number): number {
    if (!Number.isFinite(n)) return 0;
    const v = Math.trunc(n);
    if (v < 0) return 0;
    if (v > 9) return 9;
    return v;
  }

  private static parseDecimalVersion(version: string): DecimalVersion {
    const trimmed = version.trim();
    const match = /^(\d+)(?:\.([0-9]+))?$/.exec(trimmed);

    if (!match) {
      return { major: 0, digits: [0, 0, 0, 0, 0, 0] };
    }

    const major = parseInt(match[1], 10);
    const frac = match[2] ?? "";
    const digitsRaw = frac.split('').map(ch => parseInt(ch, 10)).filter(n => !Number.isNaN(n));

    const padded: number[] = digitsRaw.slice(0, 6);
    while (padded.length < 6) padded.push(0);

    return {
      major: Number.isNaN(major) ? 0 : major,
      digits: [
        GirhubTracker.clampDigit(padded[0]),
        GirhubTracker.clampDigit(padded[1]),
        GirhubTracker.clampDigit(padded[2]),
        GirhubTracker.clampDigit(padded[3]),
        GirhubTracker.clampDigit(padded[4]),
        GirhubTracker.clampDigit(padded[5])
      ]
    };
  }

  private static formatDecimalVersion(v: DecimalVersion): string {
    const digits = v.digits;

    let lastNonZero = -1;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      if (digits[i] !== 0) {
        lastNonZero = i;
        break;
      }
    }

    const minDigits = 2; // always show at least feat+fix like "2.10"
    const used = Math.max(minDigits, lastNonZero + 1);
    const frac = digits.slice(0, used).join('');

    return `${v.major}.${frac}`;
  }

  private static bumpDecimalVersion(base: DecimalVersion, tier: BumpTier, commitReadmeMajor: number | null): DecimalVersion {
    if (tier === "skip") return base;

    const needsMajorSync = (commitReadmeMajor !== null && commitReadmeMajor > base.major);
    const baseSynced: DecimalVersion = needsMajorSync
      ? { major: commitReadmeMajor as number, digits: [0, 0, 0, 0, 0, 0] }
      : base;

    if (tier === "major") {
      if (needsMajorSync) return baseSynced;
      return { major: base.major + 1, digits: [0, 0, 0, 0, 0, 0] };
    }

    const next: DecimalVersion = { major: baseSynced.major, digits: [...baseSynced.digits] as DecimalVersion["digits"] };

    const tierToIndex: Record<Exclude<BumpTier, "skip" | "major">, number> = {
      feat: 0,
      fix: 1,
      refactor: 2,
      tiny: 5
    };

    const idx = tierToIndex[tier];

    for (let i = idx + 1; i < next.digits.length; i += 1) {
      next.digits[i] = 0;
    }

    next.digits[idx] += 1;

    for (let i = idx; i >= 0; i -= 1) {
      if (next.digits[i] <= 9) break;

      next.digits[i] = 0;

      if (i === 0) {
        next.major += 1;
        break;
      }

      next.digits[i - 1] += 1;
    }

    return next;
  }

  private static extractSetVersion(message: string): string | null {
    const m = /!setver\s*(?:=|:)\s*(\d+(?:\.\d+)?)/i.exec(message);
    return m ? m[1] : null;
  }

  private static decideTierFromMessage(message: string): BumpTier | null {
    const lower = message.toLowerCase();

    if (lower.includes('!skip') || lower.includes('!skipver') || lower.includes('!noversion')) return "skip";

    const has = (tag: string): boolean => lower.includes(`!${tag}`);

    if (has('major') || has('breaking') || has('break') || has('breaking-change') || has('api-break') || has('schema-break') || has('remove')) return "major";
    if (has('feat') || has('feature') || has('minor') || has('add') || has('new') || has('enhance') || has('extend')) return "feat";
    if (has('fix') || has('bug') || has('bugfix') || has('patch') || has('hotfix') || has('security') || has('regression') || has('stability')) return "fix";
    if (has('refactor') || has('perf') || has('optimise') || has('cleanup') || has('internal') || has('techdebt')) return "refactor";

    if (
      has('docs') || has('doc') || has('readme') || has('comment') || has('comments') || has('typo') ||
      has('test') || has('tests') || has('qa') ||
      has('build') || has('ci') || has('deps') || has('dep') || has('bump') || has('upgrade') || has('tooling') ||
      has('style') || has('format') || has('lint') || has('prettier') || has('eslint') ||
      has('chore') || has('meta') || has('housekeeping')
    ) return "tiny";

    return null;
  }

  private static estimateTokens(str: string): number {
    const bytes = Buffer.byteLength(str, 'utf8');
    return Math.ceil(bytes / 2);
  }

  private static truncateDiff(diff: string, maxChars: number): string {
    if (diff.length <= maxChars) return diff;

    const headChars = Math.floor(maxChars * 0.6);
    const tailChars = maxChars - headChars;

    const head = diff.slice(0, headChars).trimEnd();
    const tail = diff.slice(diff.length - tailChars).trimStart();

    return [
      head,
      '',
      '... [diff truncated for length] ...',
      '',
      tail
    ].join('\n');
  }

  private static parseLlmTierJson(raw: string): LlmTierJson | null {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const tier = obj.tier;
      const confidence = obj.confidence;

      const okTier =
        tier === "major" ||
        tier === "feat" ||
        tier === "fix" ||
        tier === "refactor" ||
        tier === "tiny";

      if (!okTier) return null;
      const conf = typeof confidence === "number" ? confidence : 0;

      return { tier, confidence: Math.max(0, Math.min(1, conf)) };
    } catch {
      return null;
    }
  }

  private async decideTierWithLlm(message: string, diff: string): Promise<Exclude<BumpTier, "skip">> {
    if (!this.openai) return "tiny";

    const systemPrompt =
      "You classify a single git commit into a release-impact tier.\n" +
      "Return ONLY valid JSON: {\"tier\":\"major|feat|fix|refactor|tiny\",\"confidence\":0..1}.\n" +
      "Tier meanings:\n" +
      "- major: breaking public API/behaviour, incompatible schema/config/protocol change, removed/renamed exports.\n" +
      "- feat: new user-facing capability, new public API/endpoint/command/config option that adds behaviour.\n" +
      "- fix: bug/security/regression fix, correctness fix.\n" +
      "- refactor: internal restructure or performance improvement with no intended behaviour change.\n" +
      "- tiny: docs/tests/ci/style/deps/tooling/housekeeping or unclear minimal impact.\n" +
      "Choose the highest applicable tier. If unsure, choose tiny.";

    const trimmedDiff = GirhubTracker.truncateDiff(diff, 12_000);

    const userPrompt =
      "Commit message:\n" +
      message +
      "\n\nDiff:\n" +
      trimmedDiff;

    const estimated = GirhubTracker.estimateTokens(systemPrompt) + GirhubTracker.estimateTokens(userPrompt) + 1024;
    if (estimated > 40_000) return "tiny";

    try {
      const resp = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 256,
        temperature: 0
      });

      const content = resp.choices[0]?.message.content ?? "";
      const parsed = GirhubTracker.parseLlmTierJson(content);

      return parsed?.tier ?? "tiny";
    } catch (err) {
      console.warn(`[GithubTracker][${this.owner}] LLM tier classify failed, defaulting to tiny.`, err);
      return "tiny";
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

      let lastSha = '';
      let lastCommitDate: string | undefined;
      let baseVersionStr: string | null = null;

      if (lastHist && lastHist.data.commits.length) {
        const lastCommit = lastHist.data.commits[lastHist.data.commits.length - 1];
        lastSha = lastCommit.sha;
        lastCommitDate = lastCommit.date;
        baseVersionStr = lastCommit.version;
      }

      const sinceIso = this.computeSinceIso(sinceDays, lastCommitDate);
      const versionInfo = await this.getReadmeVersion(repo, branch);

      const baseFromReadme = `${versionInfo.major}.00`;
      let current = GirhubTracker.parseDecimalVersion(baseVersionStr ?? baseFromReadme);

      console.log(
        `[GithubTracker][${this.owner}/${repo}] ` +
        `lastFile=${lastHist?.file ?? '(none)'} ` +
        `lastSha=${lastSha || '(none)'} ` +
        `since=${sinceIso} ` +
        `base=${GirhubTracker.formatDecimalVersion(current)}`
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

      const outCommits: CommitSummary[] = [];

      for (const c of newCommits) {
        const commitReadmeMajor = GirhubTracker.parseDecimalVersion(c.version).major;
        const forcedMajor = commitReadmeMajor > 0 ? commitReadmeMajor : null;

        const setVer = GirhubTracker.extractSetVersion(c.message);
        if (setVer) {
          current = GirhubTracker.parseDecimalVersion(setVer);
          c.version = GirhubTracker.formatDecimalVersion(current);
          outCommits.push(c);
          continue;
        }

        const taggedTier = GirhubTracker.decideTierFromMessage(c.message);
        const tier = taggedTier ?? await this.decideTierWithLlm(c.message, c.diff);

        const next = GirhubTracker.bumpDecimalVersion(current, tier, forcedMajor);
        current = next;

        c.version = GirhubTracker.formatDecimalVersion(current);
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

  /**
   * Rebuilds commit history JSON files from the first commit to the latest commit on the branch.
   * This is intended as a one-off migration to the new versioning scheme.
   *
   * Important: major version is derived from README.md at each commit SHA (not from the current README).
   *
   * It writes multiple JSON files (chunked) so your existing summariseAll tooling can process them.
   */
  public async rebuildAllHistory(
    branch = 'main',
    commitsPerFile = 250
  ): Promise<Record<RepoIdentifier, RepoHistory[]>> {
    await this.ensureDir();

    const results: Record<RepoIdentifier, RepoHistory[]> = {};

    for (const repo of this.repos) {
      console.log(`[GithubTracker][${this.owner}/${repo}] Rebuild starting (branch=${branch})`);
      console.log(`[GithubTracker][${this.owner}/${repo}] Step 1/3: Fetching full commit list from GitHub API...`);

      const itemsNewestFirst = await this.fetchAllCommitItems(repo, branch);

      console.log(
        `[GithubTracker][${this.owner}/${repo}] Step 1/3: Received ${itemsNewestFirst.length} commit(s).`
      );

      if (!itemsNewestFirst.length) {
        console.log(`[GithubTracker][${this.owner}/${repo}] No commits found. Nothing to rebuild.`);
        results[repo] = [];
        continue;
      }

      console.log(`[GithubTracker][${this.owner}/${repo}] Step 2/3: Reversing list so we replay from oldest to newest...`);

      const items = [...itemsNewestFirst].reverse(); // oldest to newest
      const histories: RepoHistory[] = [];

      let current: DecimalVersion = GirhubTracker.parseDecimalVersion("0.00");
      let lastSeenMajor = 0;

      let pending: CommitSummary[] = [];
      let lastStampUsed: string | null = null;

      const flush = async (stampIso: string): Promise<void> => {
        if (!pending.length) return;

        let stamp = this.stampFromIso(stampIso);
        while (lastStampUsed !== null && stamp <= lastStampUsed) {
          stamp = this.bumpStampByOneSecond(stamp);
        }

        lastStampUsed = stamp;

        const fileName = `${stamp}-GithubTracker-${this.owner}-${repo}.json`;
        const filePath = path.join(this.outDir, fileName);

        const history: RepoHistory = {
          repo,
          createdAt: stampIso,
          commits: pending
        };

        console.log(
          `[GithubTracker][${this.owner}/${repo}] Flush: writing ${pending.length} commit(s) to ${fileName}...`
        );

        await writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
        histories.push(history);

        console.log(
          `[GithubTracker][${this.owner}/${repo}] Flush: wrote ${pending.length} commit(s) to ${fileName}`
        );

        pending = [];
      };

      console.log(
        `[GithubTracker][${this.owner}/${repo}] Step 3/3: Replaying ${items.length} commit(s) with versioning...`
      );

      const progressEvery = Math.max(1, Math.floor(items.length / 200)); // about 0.5% updates
      const logMessagePreview = (msg: string): string => {
        const oneLine = msg.replace(/\s+/g, ' ').trim();
        if (oneLine.length <= 120) return oneLine;
        return oneLine.slice(0, 117) + '...';
      };

      for (let i = 0; i < items.length; i += 1) {
        const commitObj = items[i];

        const sha = commitObj.sha;
        const author = commitObj.commit.author?.name || '';
        const date = commitObj.commit.author?.date || '';
        const message = commitObj.commit.message || '';
        const htmlUrl = commitObj.html_url || '';

        const idx = i + 1;
        const pct = ((idx / items.length) * 100).toFixed(1);

        if (i === 0) {
          console.log(
            `[GithubTracker][${this.owner}/${repo}] First commit: idx=${idx}/${items.length} (${pct}%) sha=${sha}`
          );
        } else if ((i % progressEvery) === 0) {
          console.log(
            `[GithubTracker][${this.owner}/${repo}] Progress: idx=${idx}/${items.length} (${pct}%) currentVersion=${GirhubTracker.formatDecimalVersion(current)}`
          );
        }

        console.log(
          `[GithubTracker][${this.owner}/${repo}] Checking commit ${idx}/${items.length} (${pct}%) sha=${sha} ` +
          `date=${date || '(no-date)'} author=${author || '(no-author)'} msg="${logMessagePreview(message)}"`
        );

        // 1) Fetch diff (can be slow, so log before/after)
        console.log(`[GithubTracker][${this.owner}/${repo}]   - Fetching diff for ${sha}...`);
        const diff = await this.fetchDiff(repo, sha);
        console.log(`[GithubTracker][${this.owner}/${repo}]   - Diff fetched (${diff.length} chars).`);

        // 2) Read README at this commit to infer major (historical)
        console.log(`[GithubTracker][${this.owner}/${repo}]   - Reading README.md at ${sha} to detect major...`);
        const commitMajor = await this.tryReadmeMajorAtSha(repo, sha, lastSeenMajor);

        if (commitMajor > 0 && commitMajor !== lastSeenMajor) {
          console.log(
            `[GithubTracker][${this.owner}/${repo}]   - Major changed via README: ${lastSeenMajor} -> ${commitMajor}`
          );
          lastSeenMajor = commitMajor;
        } else {
          console.log(
            `[GithubTracker][${this.owner}/${repo}]   - Major detected: ${commitMajor} (lastSeenMajor=${lastSeenMajor})`
          );
        }

        // 3) Decide tier and bump
        const before = GirhubTracker.formatDecimalVersion(current);

        const setVer = GirhubTracker.extractSetVersion(message);
        if (setVer) {
          console.log(
            `[GithubTracker][${this.owner}/${repo}]   - Found !setver override: ${setVer} (was ${before})`
          );
          current = GirhubTracker.parseDecimalVersion(setVer);
          const after = GirhubTracker.formatDecimalVersion(current);

          console.log(
            `[GithubTracker][${this.owner}/${repo}]   - Version set to ${after}`
          );
        } else {
          const taggedTier = GirhubTracker.decideTierFromMessage(message);

          if (taggedTier) {
            console.log(
              `[GithubTracker][${this.owner}/${repo}]   - Tier decided from tag: ${taggedTier}`
            );
          } else {
            console.log(
              `[GithubTracker][${this.owner}/${repo}]   - No tier tag found. Asking LLM to classify...`
            );
          }

          const tier = taggedTier ?? await this.decideTierWithLlm(message, diff);

          if (!taggedTier) {
            console.log(
              `[GithubTracker][${this.owner}/${repo}]   - LLM tier: ${tier}`
            );
          }

          const next = GirhubTracker.bumpDecimalVersion(
            current,
            tier,
            commitMajor > 0 ? commitMajor : null
          );

          current = next;
          const after = GirhubTracker.formatDecimalVersion(current);

          console.log(
            `[GithubTracker][${this.owner}/${repo}]   - Version bump: ${before} -> ${after} (tier=${tier})`
          );
        }

        const version = GirhubTracker.formatDecimalVersion(current);

        pending.push({
          sha,
          author,
          date,
          message,
          url: htmlUrl,
          diff,
          version
        });

        if (pending.length >= commitsPerFile) {
          const stampIso = pending[pending.length - 1]?.date || new Date().toISOString();
          console.log(
            `[GithubTracker][${this.owner}/${repo}] Chunk reached ${commitsPerFile} commit(s). Flushing to disk...`
          );
          await flush(stampIso);
        }
      }

      if (pending.length) {
        const stampIso = pending[pending.length - 1]?.date || new Date().toISOString();
        console.log(
          `[GithubTracker][${this.owner}/${repo}] Final flush (${pending.length} remaining commit(s))...`
        );
        await flush(stampIso);
      }

      results[repo] = histories;

      console.log(
        `[GithubTracker][${this.owner}/${repo}] Rebuild complete. ` +
        `files=${histories.length} commits=${items.length} finalVersion=${GirhubTracker.formatDecimalVersion(current)}`
      );
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
        version: `${commitMajor}.00` // placeholder used to carry commitReadmeMajor into the bump logic
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