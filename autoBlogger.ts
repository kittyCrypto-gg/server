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

  private async ensureDir(dir: string) {
    try { await access(dir, constants.F_OK); }
    catch { await mkdir(dir, { recursive: true }); }
  }

  private async getLatestJson(): Promise<{ file: string, json: CommitLog } | null> {
    const pattern = new RegExp(`-GithubTracker-${this.owner}-${this.repo}\\.json$`);
    const files = await readdir(this.commitsDir);
    const matches = files.filter(f => pattern.test(f));
    if (!matches.length) return null;
    matches.sort();
    const latest = matches[matches.length - 1];
    const content = await readFile(path.join(this.commitsDir, latest), 'utf-8');
    return { file: latest, json: JSON.parse(content) };
  }

  // Token estimation: 1 token ≈ 4 chars (safe for English/JSON)
  private static countTokens(str: string): number {
    return Math.ceil(str.length / 4);
  }

  // Recursively split a JSON log into valid JSON chunks, each under the specified token limit.
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
    const staticTokens = autoBlogger.countTokens(headerString) + systemPromptTokens + userPromptTokens + 32;

    const allCommitsTokens = staticTokens + autoBlogger.countTokens(JSON.stringify(commits, null, 2));
    if (allCommitsTokens < maxTokens) {
      return [JSON.stringify({ ...headerObj, commits }, null, 2)];
    }

    let low = minCommitsPerChunk;
    let high = totalCommits;
    let lastGood = minCommitsPerChunk;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const chunkCommits = commits.slice(0, mid);
      const tokens = staticTokens + autoBlogger.countTokens(JSON.stringify(chunkCommits, null, 2));
      if (tokens < maxTokens) { lastGood = mid; low = mid + 1; continue; }
      high = mid - 1;
    }

    const result: string[] = [];
    for (let i = 0; i < totalCommits; i += lastGood) {
      const chunkCommits = commits.slice(i, i + lastGood);
      const tokens = staticTokens + autoBlogger.countTokens(JSON.stringify(chunkCommits, null, 2));
      if (tokens > maxTokens && chunkCommits.length > 1) {
        const recursiveChunks = this.splitJsonByCommitsRecursive(
          { ...(headerObj as CommitLog), commits: chunkCommits },
          maxTokens,
          systemPromptTokens,
          userPromptTokens,
          1
        );
        result.push(...recursiveChunks);
        continue;
      }
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

  private async mergeSummariesToSingle(summaryArray: string[], user = "Kitty"): Promise<string> {
    const systemPrompt =
      this.strings.autoBlogger?.role ||
      "Summarise multiple partial blog post summaries into a single concise, fluent Markdown post. Use British-English and developer-facing language. Add YAML front matter if appropriate.";

    const userPrompt =
      "These are summaries generated from split commit logs (from one large JSON). Merge and rewrite as a single, fluent Markdown blog post. Remove duplicates, ensure flow, and only keep key changes:\n\n"
      + summaryArray.map((s, i) => `--- Summary ${i + 1} ---\n${s.trim()}\n`).join('\n');

    const response = await this.openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1024
    });

    return response.choices[0].message.content ?? "Error merging blog summaries.";
  }

  public async summariseLatestToBlogPost(user = "Kitty"): Promise<string> {
    await this.ensureDir(this.postsDir);
    const latest = await this.getLatestJson();
    if (!latest) throw new Error('No commit history found.');

    if (latest.json.blogged) {
      return 'Already blogged, skipping.';
    }

    const systemPrompt =
      this.strings.autoBlogger?.role ||
      "Summarise a JSON commit log as a Markdown blog post for developers. Use a clear, concise British-English style and add suitable front matter.";

    const userPromptBase =
      (this.strings.autoBlogger?.user ??
        "Write a brief, readable markdown post (with YAML front matter) based on this JSON commit log. Do not include commit SHAs or code details unless essential. Only highlight user- or developer-facing changes.\n\nCommit log JSON:\n");

    const jsonText = JSON.stringify(latest.json, null, 2);

    let summaries: string[] = [];

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPromptBase + `\n${jsonText}` }
        ],
        temperature: 0.7,
        max_tokens: 1024
      });
      summaries = [response.choices[0].message.content ?? "Error generating the blog post."];
    } catch (err) {
      // On error, extract offending token count and split properly
      const offendingTokens = autoBlogger.extractTokenCountFromError(err as OpenAIAPIErrorShape) ?? 128000;

      // Estimate tokens used by prompts
      const systemPromptTokens = autoBlogger.countTokens(systemPrompt);
      const userPromptTokens = autoBlogger.countTokens(userPromptBase);

      // Allow 1024 tokens for response buffer, and prompt size
      const maxModelTokens = 128000;
      const safetyBuffer = 2048; // a bit more conservative!
      const responseBuffer = 1024; // headroom for model's reply
      const hardCapChunkTokens = 48_000;

      const derivedCap = Math.max(
        2048,
        Math.min(
          (offendingTokens ?? maxModelTokens) - safetyBuffer - responseBuffer,
          maxModelTokens - safetyBuffer - responseBuffer
        )
      );

      const maxTokensPerChunk = Math.min(hardCapChunkTokens, derivedCap);

      // Recursively split the commit log into safe chunks
      const chunks = this.splitJsonByCommitsRecursive(
        latest.json,
        maxTokensPerChunk,
        systemPromptTokens,
        userPromptTokens
      );

      const chunkSummaries: string[] = [];
      for (const chunk of chunks) {
        // Defensive: retry splitting if this chunk still errors (e.g., a massive single commit)
        let summary: string = "";
        try {
          const response = await this.openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPromptBase + `\n${chunk}` }
            ],
            temperature: 0.7,
            max_tokens: 1024
          });
          summary = response.choices[0].message.content ?? "";
        } catch (chunkErr) {
          // If this chunk still fails, try recursively splitting further
          const tokensFromError = autoBlogger.extractTokenCountFromError(chunkErr);
          const tokens = tokensFromError ?? maxTokensPerChunk;
          if (tokens < 2048) throw chunkErr;

          const subResponseBuffer = 1024;
          const hardCapChunkTokens = 48_000;

          const subMaxTokensPerChunk = Math.min(
            hardCapChunkTokens,
            Math.max(2048, tokens - 4096 - subResponseBuffer)
          );

          const subChunks = this.splitJsonByCommitsRecursive(
            JSON.parse(chunk) as CommitLog,
            subMaxTokensPerChunk,
            systemPromptTokens,
            userPromptTokens
          );
          for (const subChunk of subChunks) {
            const response = await this.openai.chat.completions.create({
              model: "gpt-4.o-mini",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptBase + `\n${subChunk}` }
              ],
              temperature: 0.7,
              max_tokens: 1024
            });
            chunkSummaries.push(response.choices[0].message.content ?? "");
          }
          continue;
        }
        chunkSummaries.push(summary);
      }

      const merged = await this.mergeSummariesToSingle(chunkSummaries, user);
      summaries = [merged];
    }

    // Compose filename
    const now = new Date();
    const y = now.getFullYear();
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');

    const fileName = `autoBlogger-commits-${y}${m}${d}-${hh}:${mm}-${user}-${this.repo}.md`;
    const filePath = path.join(this.postsDir, fileName);

    await writeFile(filePath, summaries[0], 'utf-8');
    latest.json.blogged = true;
    await writeFile(path.join(this.commitsDir, latest.file), JSON.stringify(latest.json, null, 2), 'utf-8');
    return filePath;
  }
}

// Example usage:

// import { OpenAI } from "openai";
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// import strings from './strings.json'; // or require('./strings.json')

// const blogger = new CommitAutoBlogger('KittyCrypto-gg', 'kittyServer', openai, strings);
// blogger.summariseLatestToBlogPost("Kitty").then((outPath) => {
//   console.log('Blog post saved:', outPath);
// });