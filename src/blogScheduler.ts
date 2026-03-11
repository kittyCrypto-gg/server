import { autoBlogger, ModeratorStrings } from "./autoBlogger";
import { versionTracker } from "./readmeUpdater";
import { GirhubTracker } from "./githubTracker";
import { readFileSync } from "fs";
import { OpenAI } from "openai";
import path from "path";
/* @ts-ignore */
import "dotenv/config";

const apiKey = process.env.OPENAI_KEY || "";
const openai = new OpenAI({ apiKey });

type GithubAutoSchedulerOptions = {
  owner: string;
  repos: string[];
  blogUser?: string;
  branch?: string;
  sinceDays?: number;
};

export class GithubAutoScheduler {
  private owner: string;
  private repos: string[];
  private blogUser: string;
  private branch: string;
  private sinceDays: number;
  private openai: OpenAI = openai;
  private readonly stringsPath: string;
  private strings: { [key: string]: ModeratorStrings };


  constructor(opts: GithubAutoSchedulerOptions) {
    this.owner = opts.owner;
    this.repos = opts.repos;
    this.blogUser = opts.blogUser ?? "Kitty";
    this.branch = opts.branch ?? "main";
    this.sinceDays = opts.sinceDays ?? 30;
    this.stringsPath = path.resolve(process.cwd(), "data", "strings.json");
    this.strings = JSON.parse(readFileSync(this.stringsPath, "utf-8"));
    this.scheduleNext();
  }

  private msUntilNextSunday(): number {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();
    let daysUntil = (7 - day) % 7;
    if (daysUntil === 0 && (hour > 0 || minute > 0 || second > 0)) daysUntil = 7;
    const next = new Date(now);
    next.setDate(now.getDate() + daysUntil);
    next.setHours(0, 0, 0, 0);
    return next.getTime() - now.getTime();
  }

  private async runFullTrackingForAllRepos() {
    for (const repo of this.repos) {
      try {
        const tracker = new GirhubTracker(this.owner, [repo]);
        console.log(`[githubTracker] Fetching commits for ${repo} since last ${this.sinceDays} days...`);
        await tracker.getCommits(this.branch, this.sinceDays);
        // console.log(`[githubTracker] Rebuilding history for ${repo}...`);
        // await tracker.rebuildAll(this.branch);

        const blogger = new autoBlogger(this.owner, repo, this.openai, this.strings);

        const posts = await blogger.summariseLatest(this.blogUser, true);

        // const posts = await blogger.summariseAll(this.blogUser, false);

        for (const p of posts) {
          console.log(`[autoBlogger] Wrote: ${p}`);
        }

        console.log(`✅ Auto-tracked and blogged for ${repo} at ${new Date().toISOString()}`);
      } catch (err) {
        console.error(`❌ Error running tracking or blogging for ${repo}:`, err);
      }

      try {
        const readmeUpdater = new versionTracker(this.owner, this.repos, {
          branch: this.branch,
          outDirName: 'commitsTracker',
          dryRun: false
        });

        const results = await readmeUpdater.publish();

        for (const r of results) {
          if (r.kind === 'updated') {
            console.log(`[readmeUpdater] UPDATED ${this.owner}/${r.repo} ${r.from} -> ${r.to} commit=${r.commitSha}`);
          } else {
            console.log(`[readmeUpdater] SKIP ${this.owner}/${r.repo} reason=${r.reason}`);
          }
        }
      } catch (err) {
        console.error('❌ Error updating READMEs:', err);
      }
    }
  }

  private scheduleNext() {
    const msDelay = this.msUntilNextSunday();
    // console.log(
    //   `⏰ Next githubTracker + autoBlogger run scheduled in ${Math.floor(msDelay / 3600000)}h ${(msDelay / 60000) % 60}m`
    // );
    setTimeout(async () => {
      try {
        await this.runFullTrackingForAllRepos();
      } finally {
        // Schedule next one for 7 days later, regardless of time taken
        setTimeout(() => this.runFullTrackingForAllRepos(), 7 * 24 * 60 * 60 * 1000);
        this.scheduleNext();
      }
    }, msDelay);
  }

  public async runOnceNow(): Promise<void> {
    console.log("🔄 Running full tracking and blogging now...");
    await this.runFullTrackingForAllRepos();
    console.log("✅ Run complete. Next run will be scheduled for next Sunday.");
  }
}
