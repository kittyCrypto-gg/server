export function estimateTokens(str: string): number {
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

