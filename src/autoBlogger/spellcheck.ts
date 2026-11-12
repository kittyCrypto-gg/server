import * as fs from "fs/promises";
import path from "path";
import { diffLines } from "./markdown";
import type { OpenAIAPIErrorShape, ModeratorStrings, CommitEntry, BritishSpellcheckChunkResponse, LineChange, CommitLog } from "./types";
import type { BloggerContext } from "./context";

export async function spellcheckMd(
    ctx: BloggerContext,
    markdown: string,
    fileName: string
  ): Promise<string | null> {
    const chunks = ctx.splitMarkdown(markdown, 6000);
    const patchedChunks: string[] = [];

    for (const chunk of chunks) {
      const systemPrompt =
        "You convert American English spelling to British English spelling only. " +
        "Do not rephrase, rewrite, shorten, or expand. Only adjust spelling variants (e.g., color->colour, organize->organise) when appropriate. " +
        "Preserve every line break exactly (same number of lines, same ordering). " +
        "Do not change anything inside fenced code blocks (``` or ~~~), inline code (`like this`), URLs, or the URL target part of Markdown links. " +
        "Do not change YAML front matter keys; you may adjust British spelling inside YAML string values only. " +
        "Return ONLY valid JSON in the form {\"patched\":\"...\"} with the patched text.";

      const userPrompt =
        `File: ${fileName}\n` +
        `Chunk starts at line ${chunk.startLine}\n\n` +
        `Markdown chunk:\n` +
        chunk.text;

      let content = "";
      try {
        const resp = await ctx.openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 4096
        });

        content = resp.choices[0].message.content ?? "";
      } catch (err) {
        console.warn(
          `[autoBlogger][spellcheck][${ctx.repo}] ${fileName} chunk @${chunk.startLine} failed.`,
          err
        );
        return null;
      }

      let parsed: BritishSpellcheckChunkResponse | null = null;

      try {
        parsed = JSON.parse(content) as BritishSpellcheckChunkResponse;
      } catch {
        console.warn(
          `[autoBlogger][spellcheck][${ctx.repo}] ${fileName} chunk @${chunk.startLine} returned non-JSON. Skipping file.`
        );
        return null;
      }

      if (!parsed || typeof parsed.patched !== "string") {
        console.warn(
          `[autoBlogger][spellcheck][${ctx.repo}] ${fileName} chunk @${chunk.startLine} JSON missing "patched". Skipping file.`
        );
        return null;
      }

      const beforeLines = chunk.text.split('\n').length;
      const afterLines = parsed.patched.split('\n').length;

      if (beforeLines !== afterLines) {
        console.warn(
          `[autoBlogger][spellcheck][${ctx.repo}] ${fileName} chunk @${chunk.startLine} changed line count (${beforeLines} -> ${afterLines}). Skipping file.`
        );
        return null;
      }

      patchedChunks.push(parsed.patched);
    }

    return patchedChunks.join('\n');
}

export async function spellcheck(ctx: BloggerContext, targetPaths?: string[]): Promise<void> {
    await ctx.ensureDir(ctx.postsDir);

    const targets = (targetPaths && targetPaths.length > 0)
      ? targetPaths
        .map(p => (path.isAbsolute(p) ? p : path.join(ctx.postsDir, p)))
        .sort()
      : (await fs.readdir(ctx.postsDir))
        .filter(f => f.endsWith('.md'))
        .sort()
        .map(f => path.join(ctx.postsDir, f));

    for (const fullPath of targets) {
      const fileName = path.basename(fullPath);

      let raw = "";
      try {
        raw = await fs.readFile(fullPath, "utf-8");
      } catch {
        console.warn(`[autoBlogger][spellcheck][${ctx.repo}] Failed to read ${fullPath}`);
        continue;
      }

      const patched = await ctx.spellcheckMd(raw, fileName);
      if (patched === null) continue;
      if (patched === raw) continue;

      const changes = diffLines(raw, patched);
      const lineCountMismatch = changes.length === 1 && changes[0].line === 0;
      if (lineCountMismatch) {
        console.warn(`[autoBlogger][spellcheck][${ctx.repo}] ${fileName} line count mismatch, refusing to overwrite.`);
        continue;
      }

      await fs.writeFile(fullPath, patched, "utf-8");

      console.log(`[autoBlogger][spellcheck][${ctx.repo}] Updated ${fileName} (${changes.length} line(s) changed).`);

      for (const c of changes) {
        console.log(
          `[autoBlogger][spellcheck][${ctx.repo}] file=${fileName} line=${c.line}\n` +
          `  - ${c.before}\n` +
          `  + ${c.after}`
        );
      }
    }
}
