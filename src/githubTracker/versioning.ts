import type { BumpTier, DecimalPrecision, DecimalVersion, RepoIdentifier, CommitSummary, RepoHistory, SetverDirective, GitHubCommit, LlmTierJson } from "./types";

export function clampDigit(n: number): number {
    if (!Number.isFinite(n)) return 0;
    const v = Math.trunc(n);
    if (v < 0) return 0;
    if (v > 9) return 9;
    return v;
}

export function parseVer(version: string): DecimalVersion {
    const trimmed = version.trim();
    const match = /^(\d+)(?:\.([0-9]+))?$/.exec(trimmed);

    if (!match) {
      return { major: 0, digits: [0, 0, 0, 0, 0], precision: 1 };
    }

    const major = parseInt(match[1], 10);
    const frac = match[2] ?? "";

    const rawDigits = frac.split('')
      .map((ch) => parseInt(ch, 10))
      .filter((n) => !Number.isNaN(n));

    const precision: DecimalPrecision = ((): DecimalPrecision => {
      if (!frac || rawDigits.length === 0) return 1;
      if (rawDigits.length === 1) return 1;
      if (rawDigits.length === 2) return 2;
      if (rawDigits.length === 3) return 3;
      if (rawDigits.length === 4) return 4;
      return 5;
    })();

    const padded: number[] = rawDigits.slice(0, 5);
    while (padded.length < 5) padded.push(0);

    return {
      major: Number.isNaN(major) ? 0 : major,
      digits: [
        clampDigit(padded[0]),
        clampDigit(padded[1]),
        clampDigit(padded[2]),
        clampDigit(padded[3]),
        clampDigit(padded[4])
      ],
      precision
    };
}

export function formatVer(v: DecimalVersion): string {
    const frac = v.digits.slice(0, v.precision).join('');
    return `${v.major}.${frac}`;
}

export function withPrecisionFloor(v: DecimalVersion, precision: DecimalPrecision): DecimalVersion {
    const digits: DecimalVersion["digits"] = [...v.digits] as DecimalVersion["digits"];

    for (let i = precision; i < 5; i += 1) {
      (digits as number[])[i] = 0;
    }

    return { major: v.major, digits, precision };
}

export function incAt(v: DecimalVersion, idx: 0 | 1 | 2 | 3 | 4): DecimalVersion {
    const digits: DecimalVersion["digits"] = [...v.digits] as DecimalVersion["digits"];
    digits[idx] += 1;

    for (let i = idx; i >= 0; i -= 1) {
      if (digits[i] <= 9) return { major: v.major, digits, precision: v.precision };

      digits[i] = 0;

      if (i === 0) {
        return { major: v.major + 1, digits, precision: v.precision };
      }

      digits[i - 1] += 1;
    }

    return { major: v.major, digits, precision: v.precision };
}

export function bumpMajorTier(base: DecimalVersion): DecimalVersion {
    return { major: base.major + 1, digits: [0, 0, 0, 0, 0], precision: 1 };
}

export function bumpRefactorTier(base: DecimalVersion): DecimalVersion {
    const floored = withPrecisionFloor(base, 1);
    return incAt(floored, 0);
}

export function bumpFeatTier(base: DecimalVersion): DecimalVersion {
    // Feat keeps trailing digits and does not carry, so if the target digit is 9 we do nothing.
    if (base.digits[1] >= 9) return base;

    const digits: DecimalVersion["digits"] = [...base.digits] as DecimalVersion["digits"];
    digits[1] += 1;

    const precision: DecimalPrecision = base.precision >= 2 ? base.precision : 2;

    return { major: base.major, digits, precision };
}

export function bumpMinorTier(base: DecimalVersion): DecimalVersion {
    const floored = withPrecisionFloor(base, 3);
    return incAt(floored, 2);
}

export function bumpFixTier(base: DecimalVersion): DecimalVersion {
    const floored = withPrecisionFloor(base, 4);
    return incAt(floored, 3);
}

export function bumpTinyTier(base: DecimalVersion): DecimalVersion {
    const floored = withPrecisionFloor(base, 5);
    return incAt(floored, 4);
}

export function setverToReadmeMajor(readmeMajor: number): DecimalVersion {
    const safeMajor = Number.isFinite(readmeMajor) && readmeMajor >= 0 ? Math.trunc(readmeMajor) : 0;
    return { major: safeMajor, digits: [0, 0, 0, 0, 0], precision: 1 };
}

export function bumpVer(base: DecimalVersion, tier: BumpTier): DecimalVersion {
    if (tier === "skip") return base;
    if (tier === "major") return bumpMajorTier(base);
    if (tier === "refactor") return bumpRefactorTier(base);
    if (tier === "feat") return bumpFeatTier(base);
    if (tier === "minor") return bumpMinorTier(base);
    if (tier === "fix") return bumpFixTier(base);
    return bumpTinyTier(base);
}

export function parseSetverDirective(message: string): SetverDirective | null {
    // Forms supported:
    // - "!setver"
    // - "!setver 2.123"
    // - "!setver=2.123"
    // - "!setver:2.123"
    // If the next token starts with "!" (example: "!setver !fix"), treat as no-arg mode.
    const m = /(^|\s)!setver(?:\s*(?:=|:)?\s*([^\s]+))?/i.exec(message);
    if (!m) return null;

    const token = (m[2] ?? "").trim();
    if (!token) return { kind: "readmeMajor" };
    if (token.startsWith("!")) return { kind: "readmeMajor" };

    return { kind: "explicit", rawVersion: token };
}

export function tierFromMsg(message: string): BumpTier | null {
    const lower = message.toLowerCase();

    if (lower.includes('!skip') || lower.includes('!skipver') || lower.includes('!noversion')) return "skip";

    const has = (tag: string): boolean => lower.includes(`!${tag}`);

    // Major is now strictly an integer bump.
    if (
      has('major') || has('breaking') || has('break') || has('breaking-change') ||
      has('api-break') || has('schema-break') || has('remove')
    ) return "major";

    // Refactor is the first decimal digit bump.
    if (
      has('refactor') || has('perf') || has('optimise') || has('optimize') ||
      has('cleanup') || has('internal') || has('techdebt')
    ) return "refactor";

    if (has('feat') || has('feature') || has('add') || has('new') || has('enhance') || has('extend')) return "feat";

    if (has('minor') || has('min') || has('tweak') || has('improve')) return "minor";

    if (has('fix') || has('bug') || has('bugfix') || has('patch') || has('hotfix') || has('security') || has('regression') || has('stability')) return "fix";

    if (
      has('tiny') ||
      has('docs') || has('doc') || has('readme') || has('comment') || has('comments') || has('typo') ||
      has('test') || has('tests') || has('qa') ||
      has('build') || has('ci') || has('deps') || has('dep') || has('bump') || has('upgrade') || has('tooling') ||
      has('style') || has('format') || has('lint') || has('prettier') || has('eslint') ||
      has('chore') || has('meta') || has('housekeeping')
    ) return "tiny";

    return null;
}
