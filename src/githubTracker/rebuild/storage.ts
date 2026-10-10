import { writeFile } from "fs/promises";
import path from "path";
import type { CommitSummary, RepoHistory, RepoIdentifier } from "../types";
import type { TrackerContext } from "../context";

/** Preserve the original collision handling, write sequence and history object references. */
export function createRebuildFlusher(
    ctx: TrackerContext,
    repo: RepoIdentifier,
    histories: RepoHistory[],
): (pending: CommitSummary[], stampIso: string) => Promise<void> {
    let lastStampUsed: string | null = null;

    return async (pending: CommitSummary[], stampIso: string): Promise<void> => {
        if (!pending.length) return;

        let stamp = ctx.stampFromIso(stampIso);
        while (lastStampUsed !== null && stamp <= lastStampUsed) {
          stamp = ctx.bumpStampByOneSecond(stamp);
        }

        lastStampUsed = stamp;

        const fileName = `${stamp}-GithubTracker-${ctx.owner}-${repo}.json`;
        const filePath = path.join(ctx.outDir, fileName);

        const history: RepoHistory = {
          repo,
          createdAt: stampIso,
          commits: pending
        };

        console.log(
          `[GithubTracker][${ctx.owner}/${repo}] Flush: writing ${pending.length} commit(s) to ${fileName}...`
        );

        await writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
        histories.push(history);

        console.log(
          `[GithubTracker][${ctx.owner}/${repo}] Flush: wrote ${pending.length} commit(s) to ${fileName}`
        );

    };
}
