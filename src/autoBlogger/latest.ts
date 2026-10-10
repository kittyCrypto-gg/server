import * as fs from "fs/promises";
import path from "path";
import { summariseCommitLog } from "./summariseLog";
import type { BloggerContext } from "./context";

export async function summariseLatest(ctx: BloggerContext, user = "autoKitty", spellCheck: boolean = false): Promise<string[]> {
    await ctx.ensureDir(ctx.postsDir);

    const outPaths: string[] = [];

    try {
      const latest = await ctx.getLatestJson();
      if (!latest) throw new Error('No commit history found.');

      if (latest.json.blogged === true) return [];

      const merged = await summariseCommitLog(ctx, latest.json, user);

      const now = new Date();
      const y = now.getFullYear();
      const m = (now.getMonth() + 1).toString().padStart(2, '0');
      const d = now.getDate().toString().padStart(2, '0');
      const hh = now.getHours().toString().padStart(2, '0');
      const mm = now.getMinutes().toString().padStart(2, '0');

      const fileName = `autoBlogger-commits-${y}${m}${d}-${hh}:${mm}-${user}-${ctx.repo}.md`;
      const filePath = path.join(ctx.postsDir, fileName);

      await fs.writeFile(filePath, merged, 'utf-8');
      outPaths.push(filePath);

      latest.json.blogged = true;
      await fs.writeFile(path.join(ctx.commitsDir, latest.file), JSON.stringify(latest.json, null, 2), 'utf-8');

      return outPaths;
    } finally {
      if (spellCheck && outPaths.length > 0)
        await ctx.spellcheck(outPaths);
    }
}
