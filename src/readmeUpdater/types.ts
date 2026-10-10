export type RepoIdentifier = string;

export type CommitSummary = {
    sha: string;
    author: string;
    date: string;
    message: string;
    url: string;
    diff: string;
    version: string;
};

export type RepoHistory = {
    repo: RepoIdentifier;
    createdAt: string;
    commits: CommitSummary[];
};

export type PublishResult =
    | { kind: 'skipped'; repo: RepoIdentifier; reason: string }
    | { kind: 'updated'; repo: RepoIdentifier; from: string; to: string; commitSha: string; readmeSha: string };

export type GitHubContentResponse = {
    sha: string;
    content: string; // base64
    encoding: 'base64';
};

export type GitHubUpdateResponse = {
    content?: { sha?: string };
    commit?: { sha?: string };
};

export type ReadmePublisherOptions = {
    outDirName?: string;

    branch?: string;

    dryRun?: boolean;

    commitMessage?: string;
};

