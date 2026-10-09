import fs from "fs";
import fetch from "node-fetch";
/* @ts-ignore */
import "dotenv/config";

export type AppSource = "github" | "local";
export type AppDescriptions = Readonly<Record<string, string>>;

export interface DiscoveredApp {
    id: string;
    name: string;
    href: string;
    description: string;
    source: AppSource;
    repository?: string;
}

export interface AppDiscoverySnapshot {
    generatedAt: string | null;
    apps: readonly DiscoveredApp[];
}

interface GithubRepository {
    name: string;
    full_name: string;
    private: boolean;
    archived: boolean;
    disabled: boolean;
    has_pages: boolean;
    is_template: boolean;
}

const DEFAULT_NGINX_CONFIG_PATH = "/etc/nginx/sites-available/app.kittycrow.dev";
const DEFAULT_DESCRIPTIONS_PATH = "data/descriptions.json";
const DEFAULT_GITHUB_OWNER = "kitty-crow";
const DEFAULT_INDEX_REPOSITORY = "app-kittycrow-dev";
const DEFAULT_REFRESH_MS = 5 * 60 * 1000;
const GITHUB_PAGES_PROBE_TIMEOUT_MS = 5_000;

let currentSnapshot: AppDiscoverySnapshot = {
    generatedAt: null,
    apps: []
};

let currentDescriptions: AppDescriptions = {};
let refreshInFlight: Promise<AppDiscoverySnapshot> | null = null;
let discoveryStarted = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function getNginxConfigPath(): string {
    const configured = process.env.APP_DISCOVERY_NGINX_PATH?.trim();
    return configured || DEFAULT_NGINX_CONFIG_PATH;
}

function getDescriptionsPath(): string {
    const configured = process.env.APP_DISCOVERY_DESCRIPTIONS_PATH?.trim();
    return configured || DEFAULT_DESCRIPTIONS_PATH;
}

function getGithubOwner(): string {
    const configured = process.env.APP_DISCOVERY_GITHUB_OWNER?.trim();
    return configured || DEFAULT_GITHUB_OWNER;
}

function getIndexRepository(): string {
    const configured = process.env.APP_DISCOVERY_INDEX_REPOSITORY?.trim();
    return configured || DEFAULT_INDEX_REPOSITORY;
}

function getRefreshMs(): number {
    const configured = Number(process.env.APP_DISCOVERY_REFRESH_MS || "");

    if (Number.isFinite(configured) && configured >= 30_000) {
        return Math.floor(configured);
    }

    return DEFAULT_REFRESH_MS;
}

function canonicalHref(value: string): string {
    const path = value.trim().replace(/^\/+|\/+$/g, "");
    return path ? `/${path}/` : "/";
}

export function appIdFromHref(href: string): string {
    return canonicalHref(href)
        .replace(/^\/+|\/+$/g, "")
        .split("/")
        .filter(Boolean)
        .join("-");
}

function humaniseRoute(href: string): string {
    const path = href.replace(/^\/+|\/+$/g, "");
    const lastSegment = path.split("/").filter(Boolean).pop() || "App";

    return lastSegment
        .replace(/[-_]+/g, " ")
        .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function sectionTitleFromComment(line: string): string | null {
    const match = line.match(/^\s*#\s*(.*?)\s*$/);
    if (!match) return null;

    const value = match[1]?.trim() || "";
    const arrow = value.indexOf("->");
    if (arrow <= 0) return null;

    const title = value.slice(0, arrow).trim();
    return title || null;
}

function braceDelta(line: string): number {
    const opens = line.match(/{/g)?.length ?? 0;
    const closes = line.match(/}/g)?.length ?? 0;
    return opens - closes;
}

function isLoopbackProxyTarget(value: string): boolean {
    try {
        const target = new URL(value);
        const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");

        return hostname === "127.0.0.1"
            || hostname === "localhost"
            || hostname === "::1";
    } catch {
        return false;
    }
}

export function parseLocalAppsFromNginx(config: string): DiscoveredApp[] {
    const lines = config.split(/\r?\n/);
    const apps = new Map<string, DiscoveredApp>();
    let sectionTitle: string | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const title = sectionTitleFromComment(line);

        if (title) {
            sectionTitle = title;
        }

        const locationMatch = line.match(/^\s*location\s+(?:(?:=|\^~)\s+)?(\/[^\s{]*)\s*\{/);
        if (!locationMatch) continue;

        const route = locationMatch[1] ?? "";
        let block = line;
        let depth = braceDelta(line);

        while (depth > 0 && i + 1 < lines.length) {
            i += 1;
            const nextLine = lines[i] ?? "";
            block += `\n${nextLine}`;
            depth += braceDelta(nextLine);
        }

        const proxyMatch = block.match(/\bproxy_pass\s+([^;\s]+)\s*;/);
        if (!proxyMatch) continue;

        const proxyTarget = proxyMatch[1] ?? "";
        if (!isLoopbackProxyTarget(proxyTarget)) continue;

        const href = canonicalHref(route);
        const name = sectionTitle || humaniseRoute(href);

        apps.set(href, {
            id: appIdFromHref(href),
            name,
            href,
            description: "",
            source: "local"
        });
    }

    return Array.from(apps.values());
}

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

async function discoverGithubApps(): Promise<DiscoveredApp[]> {
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

async function discoverLocalApps(): Promise<DiscoveredApp[]> {
    const config = await fs.promises.readFile(getNginxConfigPath(), "utf8");
    return parseLocalAppsFromNginx(config);
}

function isDescriptionObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function refreshAppDescriptions(): Promise<AppDescriptions> {
    try {
        const raw = await fs.promises.readFile(getDescriptionsPath(), "utf8");
        const payload = JSON.parse(raw) as unknown;

        if (!isDescriptionObject(payload)) {
            throw new Error("App descriptions JSON must contain an object keyed by app id.");
        }

        const nextDescriptions: Record<string, string> = {};

        for (const [id, description] of Object.entries(payload)) {
            if (typeof description !== "string") {
                throw new Error(`App description for ${id} must be a string.`);
            }

            nextDescriptions[id] = description.trim();
        }

        currentDescriptions = nextDescriptions;
    } catch (error) {
        console.error(`❌ Failed to load app descriptions from ${getDescriptionsPath()}:`, error);
    }

    return currentDescriptions;
}

export function mergeDiscoveredApps(
    githubApps: readonly DiscoveredApp[],
    localApps: readonly DiscoveredApp[]
): DiscoveredApp[] {
    const apps = new Map<string, DiscoveredApp>();

    for (const app of githubApps) {
        const href = canonicalHref(app.href);
        apps.set(href, { ...app, id: appIdFromHref(href), href });
    }

    // Nginx locations take precedence over the generic GitHub Pages fallback,
    // so local applications deliberately replace a GitHub app at the same path.
    for (const app of localApps) {
        const href = canonicalHref(app.href);
        apps.set(href, { ...app, id: appIdFromHref(href), href });
    }

    return Array.from(apps.values()).sort((a, b) => {
        const byName = a.name.localeCompare(b.name, "en-GB", {
            sensitivity: "base",
            numeric: true
        });

        return byName || a.href.localeCompare(b.href, "en-GB");
    });
}

export function applyAppDescriptions(
    apps: readonly DiscoveredApp[],
    descriptions: AppDescriptions
): DiscoveredApp[] {
    return apps.map((app) => ({
        ...app,
        description: descriptions[app.id]?.trim() || ""
    }));
}

export function getAppDiscoverySnapshot(): AppDiscoverySnapshot {
    return currentSnapshot;
}

export async function refreshAppDiscovery(): Promise<AppDiscoverySnapshot> {
    if (refreshInFlight) {
        return refreshInFlight;
    }

    refreshInFlight = (async () => {
        const previous = currentSnapshot;
        const previousGithub = previous.apps.filter((app) => app.source === "github");
        const previousLocal = previous.apps.filter((app) => app.source === "local");

        const [githubResult, localResult] = await Promise.allSettled([
            discoverGithubApps(),
            discoverLocalApps()
        ]);

        if (githubResult.status === "rejected") {
            console.error("❌ GitHub app discovery failed:", githubResult.reason);
        }

        if (localResult.status === "rejected") {
            console.error("❌ Local app discovery failed:", localResult.reason);
        }

        const bothDiscoverySourcesFailed =
            githubResult.status === "rejected" && localResult.status === "rejected";

        if (bothDiscoverySourcesFailed && previous.generatedAt !== null) return previous;

        if (bothDiscoverySourcesFailed) {
            throw new AggregateError(
                [githubResult.reason, localResult.reason],
                "Both GitHub and local app discovery failed."
            );
        }

        const githubApps = githubResult.status === "fulfilled"
            ? githubResult.value
            : previousGithub;

        const localApps = localResult.status === "fulfilled"
            ? localResult.value
            : previousLocal;

        const descriptions = await refreshAppDescriptions();

        currentSnapshot = {
            generatedAt: new Date().toISOString(),
            apps: applyAppDescriptions(
                mergeDiscoveredApps(githubApps, localApps),
                descriptions
            )
        };

        console.log(`🧭 Discovered ${currentSnapshot.apps.length} applications.`);
        return currentSnapshot;
    })();

    try {
        return await refreshInFlight;
    } finally {
        refreshInFlight = null;
    }
}

export async function startAppDiscovery(): Promise<void> {
    if (discoveryStarted) return;
    discoveryStarted = true;

    try {
        await refreshAppDiscovery();
    } catch (error) {
        console.error("❌ Initial app discovery failed:", error);
    }

    if (refreshTimer !== null) return;

    refreshTimer = setInterval(() => {
        void refreshAppDiscovery().catch((error: unknown) => {
            console.error("❌ Scheduled app discovery refresh failed:", error);
        });
    }, getRefreshMs());
}
