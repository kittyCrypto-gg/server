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

type BritishSpellcheckChunkResponse = {
  patched: string;
};

type LineChange = {
  line: number; // 1-based
  before: string;
  after: string;
};

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

  private static diffLines(before: string, after: string): LineChange[] {
    const a = before.split('\n');
    const b = after.split('\n');

    if (a.length !== b.length) {
      return [{
        line: 0,
        before: `[line-count=${a.length}]`,
        after: `[line-count=${b.length}]`
      }];
    }

    const changes: LineChange[] = [];

    for (let i = 0; i < a.length; i += 1) {
      if (a[i] === b[i]) continue;
      changes.push({ line: i + 1, before: a[i], after: b[i] });
    }

    return changes;
  }

  private splitMarkdown(
    markdown: string,
    maxCharsPerChunk = 6000
  ): Array<{ startLine: number; text: string }> {
    const lines = markdown.split('\n');

    const chunks: Array<{ startLine: number; text: string }> = [];
    let buf: string[] = [];
    let bufChars = 0;
    let startLine = 1;

    let inFence = false;
    let fenceToken: '```' | '~~~' | null = null;

    const flush = () => {
      if (!buf.length) return;
      chunks.push({ startLine, text: buf.join('\n') });
      buf = [];
      bufChars = 0;
    };

    const isFenceLine = (line: string): '```' | '~~~' | null => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('```')) return '```';
      if (trimmed.startsWith('~~~')) return '~~~';
      return null;
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const fence = isFenceLine(line);

      if (!inFence && fence) {
        inFence = true;
        fenceToken = fence;
      } else if (inFence && fence && fenceToken === fence) {
        inFence = false;
        fenceToken = null;
      }

      const lineChars = line.length + 1; // + newline

      const wouldOverflow = (bufChars + lineChars) > maxCharsPerChunk;

      if (wouldOverflow && !inFence) {
        flush();
        startLine = i + 1;
      }

      buf.push(line);
      bufChars += lineChars;
    }

    flush();
    return chunks;
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

  private normalise(json: CommitLog, maxDiffCharsPerCommit: number): CommitLog {
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

  private splitJson(
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

  private static extractTknCnt(err: unknown): number | null {
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
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
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

  private async mergeSumm(summaryArray: string[], user = "Kitty"): Promise<string> {
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

  private buildSummary(): { systemPrompt: string, userPromptBase: string } {
    const examplePost = `
      ---
      title: "{AUTHOR} Commit Tracker Blog Post for {PROJECT_NAME}"
      date: {DATE_YYYY_MM_DD}
      author: {AUTHOR}
      summary: "{SUMMARY_OF_CHANGES_IN_ONE_SENTENCE}"
      slug: "{AUTHOR}-commits-summary-{DATE_YYYY_MM_DD}"
      tags: [commits, github, "source code", "{OTHER_RELEVANT_TAG_1}", "{OTHER_RELEVANT_TAG_2}"]
      ---

      - {CHANGE_SUMMARY_1}. [Commit Details]({LINK_TO_GITHUB_COMMIT_1})
      - {CHANGE_SUMMARY_2}. [Commit Details]({LINK_TO_GITHUB_COMMIT_2})
    `.trim();

    const systemPrompt =
      this.strings.autoBlogger?.role ||
      "Summarise a JSON commit log as a Markdown blog post for developers. Use clear, concise British spelling and add suitable front matter.";

    const userPromptBase =
      (this.strings.autoBlogger?.user ??
        `Write a brief, readable Markdown post (with YAML front matter) based on this JSON commit log.` +
        `\nThere is no upper bound on the number of commits. Include as many bullet points (or grouped bullets) as needed to cover all relevant changes.` +
        `\nEnsure links to relevant commits that can be clicked and point to GitHub are included (not to the repository, but to the specific commits).` +
        `\nIf multiple commits are related, group them together in the summary and provide links to the biggest commits, not the smallest ones.` +
        `\nBritish spelling should be used throughout.` +
        `\nExample Post (short example only; real output may include many more tags and bullet points):\n${examplePost}` +
        `\n The Commit Details links should be included for each bullet point, and should link to the specific commit on GitHub that the bullet is summarising. ` +
        `\nDo not include commit SHAs or code details unless essential. Only highlight user- or developer-facing changes.\n\nCommit log JSON:\n`);
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

  private async spellcheckMd(
    markdown: string,
    fileName: string
  ): Promise<string | null> {
    const chunks = this.splitMarkdown(markdown, 6000);
    const patchedChunks: string[] = [];

    for (const chunk of chunks) {
      const systemPrompt =
        "You convert American English spelling to British English spelling only. " +
        "Do not rephrase, rewrite, shorten, or expand. Only adjust spelling variants (e.g., color->colour, organize->organise) when appropriate. " +
        "Preserve every line break exactly (same number of lines, same ordering). " +
        "Do not change anything inside fenced code blocks (``` or ~~~), inline code (`like this`), URLs, or the URL target part of Markdown links. " +
        "Do not change YAML front matter keys; you may adjust British spelling inside YAML string values only. " +
        "Return ONLY valid JSON in the form {\"patched\":\"...\"} with the patched text.";

      const userPrompt =
        `File: ${fileName}\n` +
        `Chunk starts at line ${chunk.startLine}\n\n` +
        `Markdown chunk:\n` +
        chunk.text;

      let content = "";
      try {
        const resp = await this.openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 4096
        });

        content = resp.choices[0].message.content ?? "";
      } catch (err) {
        console.warn(
          `[autoBlogger][spellcheck][${this.repo}] ${fileName} chunk @${chunk.startLine} failed.`,
          err
        );
        return null;
      }

      let parsed: BritishSpellcheckChunkResponse | null = null;

      try {
        parsed = JSON.parse(content) as BritishSpellcheckChunkResponse;
      } catch {
        console.warn(
          `[autoBlogger][spellcheck][${this.repo}] ${fileName} chunk @${chunk.startLine} returned non-JSON. Skipping file.`
        );
        return null;
      }

      if (!parsed || typeof parsed.patched !== "string") {
        console.warn(
          `[autoBlogger][spellcheck][${this.repo}] ${fileName} chunk @${chunk.startLine} JSON missing "patched". Skipping file.`
        );
        return null;
      }

      const beforeLines = chunk.text.split('\n').length;
      const afterLines = parsed.patched.split('\n').length;

      if (beforeLines !== afterLines) {
        console.warn(
          `[autoBlogger][spellcheck][${this.repo}] ${fileName} chunk @${chunk.startLine} changed line count (${beforeLines} -> ${afterLines}). Skipping file.`
        );
        return null;
      }

      patchedChunks.push(parsed.patched);
    }

    return patchedChunks.join('\n');
  }

  private async spellcheck(targetPaths?: string[]): Promise<void> {
    await this.ensureDir(this.postsDir);

    const targets = (targetPaths && targetPaths.length > 0)
      ? targetPaths
        .map(p => (path.isAbsolute(p) ? p : path.join(this.postsDir, p)))
        .sort()
      : (await readdir(this.postsDir))
        .filter(f => f.endsWith('.md'))
        .sort()
        .map(f => path.join(this.postsDir, f));

    for (const fullPath of targets) {
      const fileName = path.basename(fullPath);

      let raw = "";
      try {
        raw = await readFile(fullPath, "utf-8");
      } catch {
        console.warn(`[autoBlogger][spellcheck][${this.repo}] Failed to read ${fullPath}`);
        continue;
      }

      const patched = await this.spellcheckMd(raw, fileName);
      if (patched === null) continue;
      if (patched === raw) continue;

      const changes = autoBlogger.diffLines(raw, patched);
      const lineCountMismatch = changes.length === 1 && changes[0].line === 0;
      if (lineCountMismatch) {
        console.warn(`[autoBlogger][spellcheck][${this.repo}] ${fileName} line count mismatch, refusing to overwrite.`);
        continue;
      }

      await writeFile(fullPath, patched, "utf-8");

      console.log(`[autoBlogger][spellcheck][${this.repo}] Updated ${fileName} (${changes.length} line(s) changed).`);

      for (const c of changes) {
        console.log(
          `[autoBlogger][spellcheck][${this.repo}] file=${fileName} line=${c.line}\n` +
          `  - ${c.before}\n` +
          `  + ${c.after}`
        );
      }
    }
  }

  public async summariseLatest(user = "autoKitty", spellCheck: boolean = false): Promise<string[]> {
    await this.ensureDir(this.postsDir);

    const outPaths: string[] = [];

    try {
      const latest = await this.getLatestJson();
      if (!latest) throw new Error('No commit history found.');

      if (latest.json.blogged === true) return [];

      const { systemPrompt, userPromptBase } = this.buildSummary();

      const modelContextLimit = 128_000;
      const responseBufferTokens = 2048;
      const safetyBufferTokens = 4096;

      const maxDiffCharsPerCommit = 10_000;
      const maxTokensPerChunk = 24_000;

      const llmLog = this.normalise(latest.json, maxDiffCharsPerCommit);
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
          const hint = autoBlogger.extractTknCnt(err as OpenAIAPIErrorShape);
          console.warn(
            `[autoBlogger][${this.repo}] Single-pass summarise failed, falling back to chunking.` +
            (hint ? ` tokens=${hint}` : '')
          );
        }
      }

      if (summaries.length === 0) {
        const chunks = this.splitJson(
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
            const hint = autoBlogger.extractTknCnt(chunkErr as OpenAIAPIErrorShape);
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

      const merged = await this.mergeSumm(summaries, user);

      const now = new Date();
      const y = now.getFullYear();
      const m = (now.getMonth() + 1).toString().padStart(2, '0');
      const d = now.getDate().toString().padStart(2, '0');
      const hh = now.getHours().toString().padStart(2, '0');
      const mm = now.getMinutes().toString().padStart(2, '0');

      const fileName = `autoBlogger-commits-${y}${m}${d}-${hh}:${mm}-${user}-${this.repo}.md`;
      const filePath = path.join(this.postsDir, fileName);

      await writeFile(filePath, merged, 'utf-8');
      outPaths.push(filePath);

      latest.json.blogged = true;
      await writeFile(path.join(this.commitsDir, latest.file), JSON.stringify(latest.json, null, 2), 'utf-8');

      return outPaths;
    } finally {
      if (spellCheck && outPaths.length > 0)
        await this.spellcheck(outPaths);
    }
  }

  public async summariseAll(user = "autoKitty", spellCheck: boolean = false): Promise<string[]> {
    await this.ensureDir(this.postsDir);

    const outPaths: string[] = [];

    try {
      const pattern = new RegExp(`-GithubTracker-${this.owner}-${this.repo}\\.json$`);
      const files = (await readdir(this.commitsDir))
        .filter(f => pattern.test(f))
        .sort();

      const stampTracker = (fileName: string): string => {
        const match = /^(\d{8}-\d{6})-GithubTracker-/.exec(fileName);
        return match ? match[1] : "unknown";
      };

      for (const file of files) {
        const fullPath = path.join(this.commitsDir, file);
        const raw = await readFile(fullPath, "utf-8");

        let json: CommitLog;
        try {
          json = JSON.parse(raw) as CommitLog;
        } catch {
          console.warn(`[autoBlogger][${this.repo}] Skipping invalid JSON file: ${file}`);
          continue;
        }

        if (json.blogged === true) continue;

        const { systemPrompt, userPromptBase } = this.buildSummary();

        const modelContextLimit = 128_000;
        const responseBufferTokens = 2048;
        const safetyBufferTokens = 4096;

        const maxDiffCharsPerCommit = 10_000;
        const maxTokensPerChunk = 24_000;

        const llmLog = this.normalise(json, maxDiffCharsPerCommit);
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
            const hint = autoBlogger.extractTknCnt(err as OpenAIAPIErrorShape);
            console.warn(
              `[autoBlogger][${this.repo}] Single-pass summarise failed, falling back to chunking.` +
              (hint ? ` tokens=${hint}` : '')
            );
          }
        }

        if (summaries.length === 0) {
          const chunks = this.splitJson(
            llmLog,
            maxTokensPerChunk,
            systemPromptTokens,
            userPromptTokens
          );

          console.log(`[autoBlogger][${this.repo}] ${file} split into ${chunks.length} chunk(s).`);

          for (let i = 0; i < chunks.length; i += 1) {
            const chunk = chunks[i];

            try {
              summaries.push(await this.summariseChunk(systemPrompt, userPromptBase, chunk));
              continue;
            } catch (chunkErr) {
              const hint = autoBlogger.extractTknCnt(chunkErr as OpenAIAPIErrorShape);
              console.warn(
                `[autoBlogger][${this.repo}] ${file} chunk ${i + 1}/${chunks.length} failed.` +
                (hint ? ` tokens=${hint}` : '')
              );
            }

            const parsed = JSON.parse(chunk) as CommitLog;
            const skinny = this.toSkinnyLog(parsed);
            summaries.push(await this.summariseChunk(systemPrompt, userPromptBase, JSON.stringify(skinny, null, 2)));
          }
        }

        const merged = await this.mergeSumm(summaries, user);

        const stamp = stampTracker(file);
        const fileName = `autoBlogger-commits-${stamp}-${user}-${this.repo}.md`;
        const postPath = path.join(this.postsDir, fileName);

        await writeFile(postPath, merged, "utf-8");

        json.blogged = true;
        await writeFile(fullPath, JSON.stringify(json, null, 2), "utf-8");

        outPaths.push(postPath);
      }

      return outPaths;
    } finally {
      if (spellCheck && outPaths.length > 0)
        await this.spellcheck(outPaths);
    }
  }
}