import type { BumpTier, DecimalPrecision, DecimalVersion, RepoIdentifier, CommitSummary, RepoHistory, SetverDirective, GitHubCommit, LlmTierJson } from "./types";
import type { TrackerContext } from "./context";

export function estTokens(str: string): number {
    const bytes = Buffer.byteLength(str, 'utf8');
    return Math.ceil(bytes / 2);
}

export function truncateDiff(diff: string, maxChars: number): string {
    if (diff.length <= maxChars) return diff;

    const headChars = Math.floor(maxChars * 0.6);
    const tailChars = maxChars - headChars;

    const head = diff.slice(0, headChars).trimEnd();
    const tail = diff.slice(diff.length - tailChars).trimStart();

    return [
      head,
      '',
      '... [diff truncated for length] ...',
      '',
      tail
    ].join('\n');
}

export function parseTJson(raw: string): { tier: Exclude<BumpTier, "skip">; confidence: number } | null {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const tierRaw = obj.tier;
      const confidence = obj.confidence;

      const mappedTier: Exclude<BumpTier, "skip"> | null = (() => {
        if (tierRaw === "major") return "major";
        if (tierRaw === "refactor") return "refactor";
        if (tierRaw === "feat") return "feat";
        if (tierRaw === "minor") return "minor";
        if (tierRaw === "fix") return "fix";
        if (tierRaw === "tiny") return "tiny";
        return null;
      })();

      if (!mappedTier) return null;

      const conf = typeof confidence === "number" ? confidence : 0;
      return { tier: mappedTier, confidence: Math.max(0, Math.min(1, conf)) };
    } catch {
      return null;
    }
}

export async function genTier(ctx: TrackerContext, message: string, diff: string): Promise<Exclude<BumpTier, "skip">> {
    if (!ctx.openai) return "tiny";

    const systemPrompt =
      "You classify a single git commit into a release-impact tier.\n" +
      "Return ONLY valid JSON: {\"tier\":\"major|refactor|feat|minor|fix|tiny\",\"confidence\":0..1}.\n" +
      "Tier meanings:\n" +
      "- major: breaking public API or behaviour, incompatible schema/config/protocol change, removed or renamed public exports.\n" +
      "- refactor: internal restructure or performance work with no intended behaviour change.\n" +
      "- feat: new user-facing capability or new public API that adds behaviour.\n" +
      "- minor: smaller user-facing improvement that is not a full feature and not a bugfix.\n" +
      "- fix: bug or security fix, correctness or regression fix.\n" +
      "- tiny: docs/tests/ci/style/deps/tooling/housekeeping or unclear minimal impact.\n" +
      "Choose the highest applicable tier. If unsure, choose tiny.";

    const trimmedDiff = truncateDiff(diff, 12_000);

    const userPrompt =
      "Commit message:\n" +
      message +
      "\n\nDiff:\n" +
      trimmedDiff;

    const estimated = estTokens(systemPrompt) + estTokens(userPrompt) + 1024;
    if (estimated > 40_000) return "tiny";

    try {
      const resp = await ctx.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 256,
        temperature: 0
      });

      const content = resp.choices[0]?.message.content ?? "";
      const parsed = parseTJson(content);

      return parsed?.tier ?? "tiny";
    } catch (err) {
      console.warn(`[GithubTracker][${ctx.owner}] LLM tier classify failed, defaulting to tiny.`, err);
      return "tiny";
    }
}
