import type { OpenAIAPIErrorShape, ModeratorStrings, CommitEntry, BritishSpellcheckChunkResponse, LineChange, CommitLog } from "./types";
import type { BloggerContext } from "./context";

export function diffLines(before: string, after: string): LineChange[] {
    const a = before.split('\n');
    const b = after.split('\n');

    if (a.length !== b.length) {
      return [{
        line: 0,
        before: `[line-count=${a.length}]`,
        after: `[line-count=${b.length}]`
      }];
    }

    const changes: LineChange[] = [];

    for (let i = 0; i < a.length; i += 1) {
      if (a[i] === b[i]) continue;
      changes.push({ line: i + 1, before: a[i], after: b[i] });
    }

    return changes;
}

export function splitMarkdown(
    ctx: BloggerContext,
    markdown: string,
    maxCharsPerChunk = 6000
  ): Array<{ startLine: number; text: string }> {
    const lines = markdown.split('\n');

    const chunks: Array<{ startLine: number; text: string }> = [];
    let buf: string[] = [];
    let bufChars = 0;
    let startLine = 1;

    let inFence = false;
    let fenceToken: '```' | '~~~' | null = null;

    const flush = () => {
      if (!buf.length) return;
      chunks.push({ startLine, text: buf.join('\n') });
      buf = [];
      bufChars = 0;
    };

    const isFenceLine = (line: string): '```' | '~~~' | null => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('```')) return '```';
      if (trimmed.startsWith('~~~')) return '~~~';
      return null;
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const fence = isFenceLine(line);

      if (!inFence && fence) {
        inFence = true;
        fenceToken = fence;
      } else if (inFence && fence && fenceToken === fence) {
        inFence = false;
        fenceToken = null;
      }

      const lineChars = line.length + 1; // + newline

      const wouldOverflow = (bufChars + lineChars) > maxCharsPerChunk;

      if (wouldOverflow && !inFence) {
        flush();
        startLine = i + 1;
      }

      buf.push(line);
      bufChars += lineChars;
    }

    flush();
    return chunks;
}
