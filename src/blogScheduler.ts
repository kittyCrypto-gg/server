import { type ModeratorStrings } from "./autoBlogger";
import { readFileSync } from "fs";
import { OpenAI } from "openai";
import path from "path";
/* @ts-ignore */
import "dotenv/config";
import type { GithubAutoSchedulerOptions } from "./blogScheduler/types";
import { msUntilNextSunday } from "./blogScheduler/timing";
import { trackAndBlog, publishReadmes, type SchedulerContext } from "./blogScheduler/workflows";

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
    return msUntilNextSunday();
  }

  private workflowContext(): SchedulerContext {
    return {
      owner: this.owner,
      repos: this.repos,
      blogUser: this.blogUser,
      branch: this.branch,
      sinceDays: this.sinceDays,
      openai: this.openai,
      strings: this.strings
    };
  }

  private async runFullTrackingForAllRepos() {
    for (const repo of this.repos) {
      try {
        await trackAndBlog(this.workflowContext(), repo);
      } catch (err) {
        console.error(`❌ Error running tracking or blogging for ${repo}:`, err);
      }

      try {
        await publishReadmes(this.workflowContext());
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
