import * as fs from "fs/promises";
import path from "path";
import { summariseCommitLog } from "./summariseLog";
import type { CommitLog } from "./types";
import type { BloggerContext } from "./context";

export async function summariseAll(ctx: BloggerContext, user = "autoKitty", spellCheck: boolean = false): Promise<string[]> {
    await ctx.ensureDir(ctx.postsDir);

    const outPaths: string[] = [];

    try {
      const pattern = new RegExp(`-GithubTracker-${ctx.owner}-${ctx.repo}\\.json$`);
      const files = (await fs.readdir(ctx.commitsDir))
        .filter(f => pattern.test(f))
        .sort();

      const stampTracker = (fileName: string): string => {
        const match = /^(\d{8}-\d{6})-GithubTracker-/.exec(fileName);
        return match ? match[1] : "unknown";
      };

      for (const file of files) {
        const fullPath = path.join(ctx.commitsDir, file);
        const raw = await fs.readFile(fullPath, "utf-8");

        let json: CommitLog;
        try {
          json = JSON.parse(raw) as CommitLog;
        } catch {
          console.warn(`[autoBlogger][${ctx.repo}] Skipping invalid JSON file: ${file}`);
          continue;
        }

        if (json.blogged === true) continue;

        const merged = await summariseCommitLog(ctx, json, user, file);

        const stamp = stampTracker(file);
        const fileName = `autoBlogger-commits-${stamp}-${user}-${ctx.repo}.md`;
        const postPath = path.join(ctx.postsDir, fileName);

        await fs.writeFile(postPath, merged, "utf-8");

        json.blogged = true;
        await fs.writeFile(fullPath, JSON.stringify(json, null, 2), "utf-8");

        outPaths.push(postPath);
      }

      return outPaths;
    } finally {
      if (spellCheck && outPaths.length > 0)
        await ctx.spellcheck(outPaths);
    }
}
