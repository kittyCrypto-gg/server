import { readdir, readFile, mkdir, writeFile, access, constants } from 'fs/promises';
import path from 'path';
import { OpenAI } from "openai";

export interface ModeratorStrings {
  role?: string;
  user?: string;
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

  private async getLatestJson(): Promise<{ file: string, json: any } | null> {
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
    json: any,
    maxTokens: number,
    systemPromptTokens: number,
    userPromptTokens: number,
    minCommitsPerChunk: number = 1
  ): string[] {
    const headerObj = { ...json };
    delete headerObj.commits;

    const commits = json.commits;
    const totalCommits = commits.length;

    // If there are no commits, just return the header with empty commits.
    if (totalCommits === 0) {
      return [JSON.stringify({ ...headerObj, commits: [] }, null, 2)];
    }

    // Precompute static token overhead (header, prompts, JSON brackets)
    const headerString = JSON.stringify(headerObj, null, 2);
    const staticTokens = autoBlogger.countTokens(headerString) + systemPromptTokens + userPromptTokens + 32;

    // If all commits fit, just one chunk
    const allCommitsString = JSON.stringify({ ...headerObj, commits }, null, 2);
    if (staticTokens + autoBlogger.countTokens(JSON.stringify(commits, null, 2)) < maxTokens) {
      return [allCommitsString];
    }

    // Conservative: start with a small number, double up until over limit, then binary search
    let low = minCommitsPerChunk;
    let high = totalCommits;
    let lastGood = minCommitsPerChunk;

    // Find max commits per chunk that fits in token limit
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const chunkCommits = commits.slice(0, mid);
      const chunkStr = JSON.stringify({ ...headerObj, commits: chunkCommits }, null, 2);
      const tokens = staticTokens + autoBlogger.countTokens(JSON.stringify(chunkCommits, null, 2));
      if (tokens < maxTokens) {
        lastGood = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // Now split into chunks of lastGood
    const result: string[] = [];
    for (let i = 0; i < totalCommits; i += lastGood) {
      const chunkCommits = commits.slice(i, i + lastGood);
      const chunkJson = { ...headerObj, commits: chunkCommits };
      const chunkStr = JSON.stringify(chunkJson, null, 2);
      // If chunk is still too big (e.g. due to a gigantic diff), recurse on that chunk
      const tokens = staticTokens + autoBlogger.countTokens(JSON.stringify(chunkCommits, null, 2));
      if (tokens > maxTokens && chunkCommits.length > 1) {
        // Recurse for this chunk with smaller size
        const recursiveChunks = this.splitJsonByCommitsRecursive(
          { ...headerObj, commits: chunkCommits },
          maxTokens,
          systemPromptTokens,
          userPromptTokens,
          1
        );
        result.push(...recursiveChunks);
      } else {
        result.push(chunkStr);
      }
    }
    return result;
  }

  private static extractTokenCountFromError(err: any): number | null {
    const msg = err?.error?.message || '';
    const match = msg.match(/resulted in (\d+) tokens/);
    return match ? parseInt(match[1], 10) : null;
  }

  private async mergeSummariesToSingle(summaryArray: string[], user = "Kitty"): Promise<string> {
    const systemPrompt =
      this.strings.autoBlogger?.role ||
      "Summarise multiple partial blog post summaries into a single concise, fluent Markdown post. Use British-English and developer-facing language. Add YAML front matter if appropriate.";

    const userPrompt =
      "These are summaries generated from split commit logs (from one large JSON). Merge and rewrite as a single, fluent Markdown blog post. Remove duplicates, ensure flow, and only keep key changes:\n\n"
      + summaryArray.map((s, i) => `--- Summary ${i + 1} ---\n${s.trim()}\n`).join('\n');

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
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
      const offendingTokens = autoBlogger.extractTokenCountFromError(err) ?? 128000;

      // Estimate tokens used by prompts
      const systemPromptTokens = autoBlogger.countTokens(systemPrompt);
      const userPromptTokens = autoBlogger.countTokens(userPromptBase);

      // Allow 1024 tokens for response buffer, and prompt size
      const maxModelTokens = 128000;
      const safetyBuffer = 2048; // a bit more conservative!
      const responseBuffer = 1024; // headroom for model's reply
      const maxTokensPerChunk = Math.max(
        2048,
        Math.min(
          offendingTokens - safetyBuffer - responseBuffer,
          maxModelTokens - safetyBuffer - responseBuffer
        )
      );

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
          const tokens = autoBlogger.extractTokenCountFromError(chunkErr) ?? maxTokensPerChunk;
          if (tokens < 2048) throw chunkErr; // Give up if just too small
          const systemPromptTokens2 = systemPromptTokens;
          const userPromptTokens2 = userPromptTokens;
          const subResponseBuffer = 1024;
          const subChunks = this.splitJsonByCommitsRecursive(
            JSON.parse(chunk),
            Math.max(1024, tokens - subResponseBuffer),
            systemPromptTokens2,
            userPromptTokens2
          );
          for (const subChunk of subChunks) {
            const response = await this.openai.chat.completions.create({
              model: "gpt-4o-mini",
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