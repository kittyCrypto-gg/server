import { autoBlogger, type ModeratorStrings } from "../autoBlogger";
import { versionTracker } from "../readmeUpdater";
import { GirhubTracker } from "../githubTracker";
import type { OpenAI } from "openai";

export interface SchedulerContext {
  owner: string;
  repos: string[];
  blogUser: string;
  branch: string;
  sinceDays: number;
  openai: OpenAI;
  strings: { [key: string]: ModeratorStrings };
}

export async function trackAndBlog(ctx: SchedulerContext, repo: string): Promise<void> {
    const tracker = new GirhubTracker(ctx.owner, [repo]);
    console.log(`[githubTracker] Fetching commits for ${repo} since last ${ctx.sinceDays} days...`);
    await tracker.getCommits(ctx.branch, ctx.sinceDays);
    // console.log(`[githubTracker] Rebuilding history for ${repo}...`);
    // await tracker.rebuildAll(ctx.branch);

    const blogger = new autoBlogger(ctx.owner, repo, ctx.openai, ctx.strings);

    const posts = await blogger.summariseLatest(ctx.blogUser, true);

    // const posts = await blogger.summariseAll(ctx.blogUser, false);

    for (const p of posts) {
      console.log(`[autoBlogger] Wrote: ${p}`);
    }

    console.log(`✅ Auto-tracked and blogged for ${repo} at ${new Date().toISOString()}`);
}

export async function publishReadmes(ctx: SchedulerContext): Promise<void> {
    const readmeUpdater = new versionTracker(ctx.owner, ctx.repos, {
      branch: ctx.branch,
      outDirName: 'commitsTracker',
      dryRun: false
    });

    const results = await readmeUpdater.publish();

    for (const r of results) {
      if (r.kind === 'updated') {
        console.log(`[readmeUpdater] UPDATED ${ctx.owner}/${r.repo} ${r.from} -> ${r.to} commit=${r.commitSha}`);
      } else {
        console.log(`[readmeUpdater] SKIP ${ctx.owner}/${r.repo} reason=${r.reason}`);
      }
    }
}
