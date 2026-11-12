import type { OpenAIAPIErrorShape, ModeratorStrings, CommitEntry, BritishSpellcheckChunkResponse, LineChange, CommitLog } from "./types";
import type { BloggerContext } from "./context";

export function buildMergePrompts(ctx: BloggerContext, summaryBatch: string[], user: string): { systemPrompt: string, userPrompt: string } {
    const systemPrompt =
      ctx.strings.autoBlogger?.role ||
      "Summarise multiple partial blog post summaries into a single concise, fluent Markdown post. Use British-English and developer-facing language. Add YAML front matter if appropriate.";

    const joined = summaryBatch
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .join('\n\n---\n\n');

    const userPrompt =
      "Merge and rewrite the following partial summaries into a single, fluent Markdown blog post. " +
      "Remove duplicates, ensure flow, and keep only the key changes. " +
      `If you include YAML front matter, include author: ${user}.\n\n` +
      joined;

    return { systemPrompt, userPrompt };
}

export function buildSummary(ctx: BloggerContext): { systemPrompt: string, userPromptBase: string } {
    const examplePost = `
      ---
      title: "{AUTHOR} Commit Tracker Blog Post for {PROJECT_NAME}"
      date: {DATE_YYYY_MM_DD}
      author: {AUTHOR}
      summary: "{SUMMARY_OF_CHANGES_IN_ONE_SENTENCE}"
      slug: "{AUTHOR}-commits-summary-{DATE_YYYY_MM_DD}"
      tags: [commits, github, "source code", "{OTHER_RELEVANT_TAG_1}", "{OTHER_RELEVANT_TAG_2}"]
      ---

      - {CHANGE_SUMMARY_1}. [Commit Details]({LINK_TO_GITHUB_COMMIT_1})
      - {CHANGE_SUMMARY_2}. [Commit Details]({LINK_TO_GITHUB_COMMIT_2})
    `.trim();

    const systemPrompt =
      ctx.strings.autoBlogger?.role ||
      "Summarise a JSON commit log as a Markdown blog post for developers. Use clear, concise British spelling and add suitable front matter.";

    const userPromptBase =
      (ctx.strings.autoBlogger?.user ??
        `Write a brief, readable Markdown post (with YAML front matter) based on this JSON commit log.` +
        `\nIf the commit summary starts with !skip, do not include it in the output at all.` +
        `\nThere is no upper bound on the number of commits. Include as many bullet points (or grouped bullets) as needed to cover all relevant changes.` +
        `\nEnsure links to relevant commits that can be clicked and point to GitHub are included (not to the repository, but to the specific commits).` +
        `\nIf multiple commits are related, group them together in the summary and provide links to the biggest commits, not the smallest ones.` +
        `\nBritish spelling should be used throughout.` +
        `\nExample Post (short example only; real output may include many more tags and bullet points):\n${examplePost}` +
        `\n The Commit Details links should be included for each bullet point, and should link to the specific commit on GitHub that the bullet is summarising. ` +
        `\nDo not include commit SHAs or code details unless essential. Only highlight user- or developer-facing changes.\n\nCommit log JSON:\n`);
    return { systemPrompt, userPromptBase };
}
