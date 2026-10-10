export interface SchedulerCycleHandlers {
  track(repo: string): Promise<void>;
  publish(): Promise<void>;
}

export async function runRepositoryCycle(
  repos: readonly string[],
  handlers: SchedulerCycleHandlers
): Promise<void> {
  for (const repo of repos) {
    try {
      await handlers.track(repo);
    } catch (err) {
      console.error(`❌ Error running tracking or blogging for ${repo}:`, err);
    }

    try {
      await handlers.publish();
    } catch (err) {
      console.error("❌ Error updating READMEs:", err);
    }
  }
}
