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

  public async summariseLatestToBlogPost(user = "Kitty"): Promise<string> {
    await this.ensureDir(this.postsDir);
    const latest = await this.getLatestJson();
    if (!latest) throw new Error('No commit history found.');

    // Prefer strings.autoBlogger for role and user; else fallback to concise defaults
    const systemPrompt =
      this.strings.autoBlogger?.role ||
      "Summarise a JSON commit log as a Markdown blog post for developers. Use a clear, concise British-English style and add suitable front matter.";

    const userPrompt =
      (this.strings.autoBlogger?.user ?? "Write a brief, readable markdown post (with YAML front matter) based on this JSON commit log. Do not include commit SHAs or code details unless essential. Only highlight user- or developer-facing changes.\n\nCommit log JSON:\n")
      + `\n${JSON.stringify(latest.json, null, 2)}`;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1024
    });

    const blogPost = response.choices[0].message.content ?? "Error generating the blog post.";
    // Compose filename
    const now = new Date();
    const y = now.getFullYear();
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');

    const fileName = `autoBlogger-commits-${y}${m}${d}-${hh}:${mm}-${user}-${this.repo}.md`;
    const filePath = path.join(this.postsDir, fileName);

    await writeFile(filePath, blogPost, 'utf-8');
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