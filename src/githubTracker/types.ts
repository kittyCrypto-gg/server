export type BumpTier =
  | "skip"
  | "major"     // integer bump only
  | "refactor"  // 1st decimal digit
  | "feat"      // 2nd decimal digit (keeps trailing digits, no carry)
  | "minor"     // 3rd decimal digit
  | "fix"       // 4th decimal digit
  | "tiny";     // 5th decimal digit

export type DecimalPrecision = 1 | 2 | 3 | 4 | 5;

export type DecimalVersion = {
  major: number; // integer part (top version)
  digits: [number, number, number, number, number]; // decimal places (1..5), left-to-right
  precision: DecimalPrecision; // how many decimal digits to display
};

export type RepoIdentifier = string;

export type CommitSummary = {
  sha: string;
  author: string;
  date: string;
  message: string;
  url: string;
  diff: string;
  version: string; // decimal version string, e.g. "2.9", "2.90", "2.900", "2.9000", "2.90001"
};

export type RepoHistory = {
  repo: RepoIdentifier;
  createdAt: string;
  commits: CommitSummary[];
};

export type SetverDirective =
  | { kind: "readmeMajor" }
  | { kind: "explicit"; rawVersion: string };

export interface GitHubCommit {
  sha: string;
  html_url?: string;
  commit: {
    message: string;
    author?: {
      name?: string;
      date?: string;
    };
  };
}

export type LlmTierJson = {
  tier: "major" | "refactor" | "feat" | "minor" | "fix" | "tiny";
  confidence: number;
};
