export interface OpenAIAPIErrorShape {
  error?: { message?: string };
}

export interface ModeratorStrings {
  role?: string;
  user?: string;
}

export interface CommitEntry {
  sha: string;
  author: string;
  date: string & { readonly __iso8601: unique symbol };
  message: string;
  url: string;
  diff: string;
  version?: string;
}

export type BritishSpellcheckChunkResponse = {
  patched: string;
};

export type LineChange = {
  line: number; // 1-based
  before: string;
  after: string;
};

export interface CommitLog {
  repo: string;
  createdAt: string & { readonly __iso8601: unique symbol };
  commits: CommitEntry[];
  blogged?: boolean;
}

