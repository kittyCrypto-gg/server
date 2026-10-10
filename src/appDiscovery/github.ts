import fetch from "node-fetch";
import { DEFAULT_GITHUB_OWNER, DEFAULT_INDEX_REPOSITORY, GITHUB_PAGES_PROBE_TIMEOUT_MS, getGithubOwner, getIndexRepository } from "./config";
import { canonicalHref, appIdFromHref } from "./routes";
import type { GithubRepository, DiscoveredApp } from "./types";

function isGithubRepository(value: unknown): value is GithubRepository {
    if (typeof value !== "object" || value === null) return false;

    const repo = value as Record<string, unknown>;

    return typeof repo.name === "string"
        && typeof repo.full_name === "string"
        && typeof repo.private === "boolean"
        && typeof repo.archived === "boolean"
        && typeof repo.disabled === "boolean"
        && typeof repo.has_pages === "boolean"
        && typeof repo.is_template === "boolean";
}

export function githubRepoToApp(
    value: unknown,
    owner = DEFAULT_GITHUB_OWNER,
    indexRepository = DEFAULT_INDEX_REPOSITORY
): DiscoveredApp | null {
    if (!isGithubRepository(value)) return null;

    if (value.private || value.archived || value.disabled || value.is_template || !value.has_pages) {
        return null;
    }

    if (value.name === indexRepository) {
        return null;
    }

    const href = canonicalHref(value.name);

    return {
        id: appIdFromHref(href),
        name: value.name,
        href,
        description: "",
        source: "github",
        repository: value.full_name
    };
}

export async function isGithubPagesReachable(
    owner: string,
    repositoryName: string
): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GITHUB_PAGES_PROBE_TIMEOUT_MS);
    const url = `https://${owner}.github.io/${encodeURIComponent(repositoryName)}/`;

    try {
        const response = await fetch(url, {
            method: "HEAD",
            redirect: "manual",
            signal: controller.signal,
            headers: {
                "User-Agent": "kittycrow-app-discovery"
            }
        });

        if (response.status >= 200 && response.status < 400) {
            return true;
        }

        if (response.status === 404 || response.status === 410) {
            return false;
        }

        throw new Error(`GitHub Pages probe failed for ${repositoryName}: ${response.status} ${response.statusText}`);
    } finally {
        clearTimeout(timeout);
    }
}

export async function discoverGithubApps(): Promise<DiscoveredApp[]> {
    const owner = getGithubOwner();
    const indexRepository = getIndexRepository();
    const headers: Record<string, string> = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "kittycrow-app-discovery",
        "X-GitHub-Api-Version": "2022-11-28"
    };

    if (process.env.GITHUB_TOKEN?.trim()) {
        headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
    }

    const apps: DiscoveredApp[] = [];

    for (let page = 1; ; page += 1) {
        const url = new URL(`https://api.github.com/users/${encodeURIComponent(owner)}/repos`);
        url.searchParams.set("type", "owner");
        url.searchParams.set("sort", "full_name");
        url.searchParams.set("direction", "asc");
        url.searchParams.set("per_page", "100");
        url.searchParams.set("page", String(page));

        const response = await fetch(url, { headers });

        if (!response.ok) {
            throw new Error(`GitHub repository discovery failed: ${response.status} ${response.statusText}`);
        }

        const payload = await response.json() as unknown;

        if (!Array.isArray(payload)) {
            throw new Error("GitHub repository discovery returned a non-array response.");
        }

        const pageApps = await Promise.all(payload.map(async (repo) => {
            const app = githubRepoToApp(repo, owner, indexRepository);
            if (!app) return null;

            return await isGithubPagesReachable(owner, app.name)
                ? app
                : null;
        }));

        for (const app of pageApps) {
            if (app) apps.push(app);
        }

        if (payload.length < 100) break;
    }

    return apps;
}
