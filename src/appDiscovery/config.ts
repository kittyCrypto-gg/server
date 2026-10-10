export const DEFAULT_NGINX_CONFIG_PATH = "/etc/nginx/sites-available/app.kittycrow.dev";
export const DEFAULT_DESCRIPTIONS_PATH = "data/descriptions.json";
export const DEFAULT_GITHUB_OWNER = "kitty-crow";
export const DEFAULT_INDEX_REPOSITORY = "app-kittycrow-dev";
export const DEFAULT_REFRESH_MS = 5 * 60 * 1000;
export const GITHUB_PAGES_PROBE_TIMEOUT_MS = 5_000;
export function getNginxConfigPath(): string {
    const configured = process.env.APP_DISCOVERY_NGINX_PATH?.trim();
    return configured || DEFAULT_NGINX_CONFIG_PATH;
}

export function getDescriptionsPath(): string {
    const configured = process.env.APP_DISCOVERY_DESCRIPTIONS_PATH?.trim();
    return configured || DEFAULT_DESCRIPTIONS_PATH;
}

export function getGithubOwner(): string {
    const configured = process.env.APP_DISCOVERY_GITHUB_OWNER?.trim();
    return configured || DEFAULT_GITHUB_OWNER;
}

export function getIndexRepository(): string {
    const configured = process.env.APP_DISCOVERY_INDEX_REPOSITORY?.trim();
    return configured || DEFAULT_INDEX_REPOSITORY;
}

export function getRefreshMs(): number {
    const configured = Number(process.env.APP_DISCOVERY_REFRESH_MS || "");

    if (Number.isFinite(configured) && configured >= 30_000) {
        return Math.floor(configured);
    }

    return DEFAULT_REFRESH_MS;
}
