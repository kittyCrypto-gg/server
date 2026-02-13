import { readdir, readFile, mkdir, writeFile, access, constants } from 'fs/promises';
import path from 'path';
import { OpenAI } from "openai";

interface OpenAIAPIErrorShape {
  error?: { message?: string };
}

export interface ModeratorStrings {
  role?: string;
  user?: string;
}

export interface CommitEntry {
  sha: string;
  author: string;
  date: string & { readonly __iso8601: unique symbol };
  message: string;
  url: string;
  diff: string;
  version?: string;
}

export interface CommitLog {
  repo: string;
  createdAt: string & { readonly __iso8601: unique symbol };
  commits: CommitEntry[];
  blogged?: boolean;
}

export class autoBlogger {
  private owner: string;
  private repo: string;
  private openai: OpenAI;
  private strings: { [key: string]: ModeratorStrings };
  private commitsDir: string;
  private postsDir: string;

  constructor(
    owner: string,
    repo: string,
    openai: OpenAI,
    strings: { [key: string]: ModeratorStrings },
    commitsDir = './commitsTracker',
    postsDir = './blogposts'
  ) {
    this.owner = owner;
    this.repo = repo;
    this.openai = openai;
    this.strings = strings;
    this.commitsDir = path.resolve(process.cwd(), commitsDir);
    this.postsDir = path.resolve(process.cwd(), postsDir);
  }

  private async ensureDir(dir: string): Promise<void> {
    try {
      await access(dir, constants.F_OK);
    } catch {
      await mkdir(dir, { recursive: true });
    }
  }

  private async getLatestJson(): Promise<{ file: string, json: CommitLog } | null> {
    const pattern = new RegExp(`-GithubTracker-${this.owner}-${this.repo}\\.json$`);
    const files = await readdir(this.commitsDir);
    const matches = files.filter(f => pattern.test(f));

    if (!matches.length) return null;

    matches.sort();
    const latest = matches[matches.length - 1];
    const content = await readFile(path.join(this.commitsDir, latest), 'utf-8');
    return { file: latest, json: JSON.parse(content) as CommitLog };
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

  private normaliseCommitLogForLlm(json: CommitLog, maxDiffCharsPerCommit: number): CommitLog {
    return {
      repo: json.repo,
      createdAt: json.createdAt,
      blogged: json.blogged,
      commits: json.commits.map(c => ({
        ...c,
        diff: autoBlogger.truncateDiff(c.diff ?? '', maxDiffCharsPerCommit)
      }))
    };
  }

  private splitJsonByCommitsRecursive(
    json: CommitLog,
    maxTokens: number,
    systemPromptTokens: number,
    userPromptTokens: number,
    minCommitsPerChunk: number = 1
  ): string[] {
    const { commits, ...headerObj } = json;
    const totalCommits = commits.length;

    if (totalCommits === 0) {
      return [JSON.stringify({ ...headerObj, commits: [] }, null, 2)];
    }

    const headerString = JSON.stringify(headerObj, null, 2);
    const staticTokens =
      autoBlogger.estimateTokens(headerString) +
      systemPromptTokens +
      userPromptTokens +
      256;

    const allCommitsTokens = staticTokens + autoBlogger.estimateTokens(JSON.stringify(commits, null, 2));
    if (allCommitsTokens < maxTokens) {
      return [JSON.stringify({ ...headerObj, commits }, null, 2)];
    }

    let low = Math.max(1, minCommitsPerChunk);
    let high = totalCommits;
    let lastGood = low;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const chunkCommits = commits.slice(0, mid);
      const tokens = staticTokens + autoBlogger.estimateTokens(JSON.stringify(chunkCommits, null, 2));

      if (tokens < maxTokens) {
        lastGood = mid;
        low = mid + 1;
        continue;
      }

      high = mid - 1;
    }

    const chunkSize = Math.max(1, lastGood);

    const result: string[] = [];
    for (let i = 0; i < totalCommits; i += chunkSize) {
      const chunkCommits = commits.slice(i, i + chunkSize);
      result.push(JSON.stringify({ ...headerObj, commits: chunkCommits }, null, 2));
    }

    return result;
  }

  private static extractTokenCountFromError(err: unknown): number | null {
    if (!err || typeof err !== "object") return null;

    const errAny = err as {
      message?: unknown;
      error?: { message?: unknown };
    };

    const msg =
      (typeof errAny.error?.message === "string" && errAny.error.message) ||
      (typeof errAny.message === "string" && errAny.message) ||
      "";

    const match = msg.match(/resulted in (\d+) tokens/);
    return match ? Number(match[1]) : null;
  }

  private buildMergePrompts(summaryBatch: string[], user: string): { systemPrompt: string, userPrompt: string } {
    const systemPrompt =
      this.strings.autoBlogger?.role ||
      "Summarise multiple partial blog post summaries into a single concise, fluent Markdown post. Use British-English and developer-facing language. Add YAML front matter if appropriate.";

    const joined = summaryBatch
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .join('\n\n---\n\n');

    const userPrompt =
      "Merge and rewrite the following partial summaries into a single, fluent Markdown blog post. " +
      "Remove duplicates, ensure flow, and keep only the key changes. " +
      `If you include YAML front matter, include author: ${user}.\n\n` +
      joined;

    return { systemPrompt, userPrompt };
  }

  private async mergeSummariesBatch(summaryBatch: string[], user: string): Promise<string> {
    const { systemPrompt, userPrompt } = this.buildMergePrompts(summaryBatch, user);

    const response = await this.openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1536
    });

    return response.choices[0].message.content ?? "Error merging blog summaries.";
  }

  private async mergeSummariesBatchSafely(summaryBatch: string[], user: string, maxInputTokens: number): Promise<string> {
    const cleaned = summaryBatch.map(s => s.trim()).filter(s => s.length > 0);

    if (cleaned.length === 0) return "No changes detected.";
    if (cleaned.length === 1) return cleaned[0];

    const { systemPrompt, userPrompt } = this.buildMergePrompts(cleaned, user);
    const estimated =
      autoBlogger.estimateTokens(systemPrompt) +
      autoBlogger.estimateTokens(userPrompt) +
      4096;

    if (estimated <= maxInputTokens) {
      return this.mergeSummariesBatch(cleaned, user);
    }

    const mid = Math.ceil(cleaned.length / 2);
    const left = await this.mergeSummariesBatchSafely(cleaned.slice(0, mid), user, maxInputTokens);
    const right = await this.mergeSummariesBatchSafely(cleaned.slice(mid), user, maxInputTokens);
    return this.mergeSummariesBatchSafely([left, right], user, maxInputTokens);
  }

  private async mergeSummariesToSingle(summaryArray: string[], user = "Kitty"): Promise<string> {
    const cleaned = summaryArray.map(s => s.trim()).filter(s => s.length > 0);

    if (cleaned.length === 0) return "No changes detected.";
    if (cleaned.length === 1) return cleaned[0];

    const maxInputTokens = 80_000;

    let current = cleaned;
    const batchSize = 8;

    while (current.length > 1) {
      const next: string[] = [];

      for (let i = 0; i < current.length; i += batchSize) {
        const batch = current.slice(i, i + batchSize);
        next.push(await this.mergeSummariesBatchSafely(batch, user, maxInputTokens));
      }

      current = next;
    }

    return current[0];
  }

  private buildSummarisePrompts(): { systemPrompt: string, userPromptBase: string } {
    const systemPrompt =
      this.strings.autoBlogger?.role ||
      "Summarise a JSON commit log as a Markdown blog post for developers. Use a clear, concise British-English style and add suitable front matter.";

    const userPromptBase =
      (this.strings.autoBlogger?.user ??
        "Write a brief, readable markdown post (with YAML front matter) based on this JSON commit log. " +
        "Do not include commit SHAs or code details unless essential. Only highlight user- or developer-facing changes.\n\nCommit log JSON:\n");

    return { systemPrompt, userPromptBase };
  }

  private async summariseChunk(systemPrompt: string, userPromptBase: string, jsonChunk: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPromptBase + `\n${jsonChunk}` }
      ],
      temperature: 0.7,
      max_tokens: 1024
    });

    return response.choices[0].message.content ?? "";
  }

  private toSkinnyLog(log: CommitLog): CommitLog {
    return {
      repo: log.repo,
      createdAt: log.createdAt,
      blogged: log.blogged,
      commits: log.commits.map(c => ({
        ...c,
        diff: ''
      }))
    };
  }

  public async summariseLatestToBlogPost(user = "Kitty"): Promise<string> {
    await this.ensureDir(this.postsDir);

    const latest = await this.getLatestJson();
    if (!latest) throw new Error('No commit history found.');

    if (latest.json.blogged) return 'Already blogged, skipping.';

    const { systemPrompt, userPromptBase } = this.buildSummarisePrompts();

    const modelContextLimit = 128_000;
    const responseBufferTokens = 2048;
    const safetyBufferTokens = 4096;

    const maxDiffCharsPerCommit = 10_000;
    const maxTokensPerChunk = 24_000;

    const llmLog = this.normaliseCommitLogForLlm(latest.json, maxDiffCharsPerCommit);
    const jsonText = JSON.stringify(llmLog, null, 2);

    const systemPromptTokens = autoBlogger.estimateTokens(systemPrompt);
    const userPromptTokens = autoBlogger.estimateTokens(userPromptBase);

    const wholeEstimate =
      systemPromptTokens +
      userPromptTokens +
      autoBlogger.estimateTokens(jsonText) +
      responseBufferTokens +
      safetyBufferTokens;

    const summaries: string[] = [];

    const canTrySingle = wholeEstimate < modelContextLimit;

    if (canTrySingle) {
      try {
        summaries.push(await this.summariseChunk(systemPrompt, userPromptBase, jsonText));
      } catch (err) {
        const hint = autoBlogger.extractTokenCountFromError(err as OpenAIAPIErrorShape);
        console.warn(
          `[autoBlogger][${this.repo}] Single-pass summarise failed, falling back to chunking.` +
          (hint ? ` tokens=${hint}` : '')
        );
      }
    }

    const needsChunking = summaries.length === 0;

    if (needsChunking) {
      const chunks = this.splitJsonByCommitsRecursive(
        llmLog,
        maxTokensPerChunk,
        systemPromptTokens,
        userPromptTokens
      );

      console.log(`[autoBlogger][${this.repo}] Splitting into ${chunks.length} chunk(s).`);

      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];

        try {
          summaries.push(await this.summariseChunk(systemPrompt, userPromptBase, chunk));
          continue;
        } catch (chunkErr) {
          const hint = autoBlogger.extractTokenCountFromError(chunkErr as OpenAIAPIErrorShape);
          console.warn(
            `[autoBlogger][${this.repo}] Chunk ${i + 1}/${chunks.length} failed.` +
            (hint ? ` tokens=${hint}` : '')
          );
        }

        const parsed = JSON.parse(chunk) as CommitLog;
        const skinny = this.toSkinnyLog(parsed);
        summaries.push(await this.summariseChunk(systemPrompt, userPromptBase, JSON.stringify(skinny, null, 2)));
      }
    }

    const merged = await this.mergeSummariesToSingle(summaries, user);

    const now = new Date();
    const y = now.getFullYear();
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');

    const fileName = `autoBlogger-commits-${y}${m}${d}-${hh}:${mm}-${user}-${this.repo}.md`;
    const filePath = path.join(this.postsDir, fileName);

    await writeFile(filePath, merged, 'utf-8');

    latest.json.blogged = true;
    await writeFile(path.join(this.commitsDir, latest.file), JSON.stringify(latest.json, null, 2), 'utf-8');

    return filePath;
  }
}