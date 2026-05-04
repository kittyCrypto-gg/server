type CfCacheOptions = {
    cacheEverything?: boolean;
    cacheTtl?: number;
    cacheKey?: string;
};

type CloudflareRequestInit = RequestInit & {
    cf?: CfCacheOptions;
};

type AllowedSourceRule =
    | {
        kind: "exact";
        value: string;
    }
    | {
        kind: "prefix";
        value: string;
    };

const ALLOWLIST_URL = "https://srv.kittycrow.dev/allowedSources.json";
const ALLOWLIST_TTL_MS = 60_000;

let cachedAllowlist: AllowedSourceRule[] | null = null;
let cachedAtMs = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseSourcesPayload(value: unknown): string[] | null {
    if (!isRecord(value)) return null;

    const sourcesValue = value["sources"];
    if (!Array.isArray(sourcesValue)) return null;

    const cleaned: string[] = [];
    for (const item of sourcesValue) {
        if (typeof item !== "string") continue;

        const trimmed = item.trim();
        if (!trimmed) continue;

        cleaned.push(trimmed);
    }

    return cleaned;
}

function safeHttpsUrl(value: string): string | null {
    let url: URL;

    try {
        url = new URL(value);
    } catch {
        return null;
    }

    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;

    return url.toString();
}

function compileAllowedRules(sources: string[]): AllowedSourceRule[] {
    const rules: AllowedSourceRule[] = [];

    for (const source of sources) {
        const isWildcard = source.endsWith("*");
        const rawValue = isWildcard ? source.slice(0, -1) : source;
        const safeValue = safeHttpsUrl(rawValue);

        if (safeValue === null) continue;

        rules.push(
            isWildcard
                ? { kind: "prefix", value: safeValue }
                : { kind: "exact", value: safeValue }
        );
    }

    return rules;
}

function emptyAllowlist(): AllowedSourceRule[] {
    cachedAllowlist = [];
    cachedAtMs = Date.now();
    return cachedAllowlist;
}

async function getAllowedRules(): Promise<AllowedSourceRule[]> {
    const now = Date.now();
    if (cachedAllowlist !== null && now - cachedAtMs < ALLOWLIST_TTL_MS) {
        return cachedAllowlist;
    }

    const controller = new AbortController();
    const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), 2500);

    try {
        const initReq: CloudflareRequestInit = {
            signal: controller.signal,
            headers: { Accept: "application/json" },
            cf: { cacheTtl: 60, cacheEverything: true }
        };

        const res = await fetch(ALLOWLIST_URL, initReq);
        if (!res.ok) return emptyAllowlist();

        const json: unknown = await res.json();
        const sources = parseSourcesPayload(json);
        if (sources === null) return emptyAllowlist();

        cachedAllowlist = compileAllowedRules(sources);
        cachedAtMs = now;

        return cachedAllowlist;
    } catch {
        return emptyAllowlist();
    } finally {
        clearTimeout(timeoutId);
    }
}

function isAllowedUrl(url: string, rules: AllowedSourceRule[]): boolean {
    for (const rule of rules) {
        if (rule.kind === "exact" && rule.value === url) return true;
        if (rule.kind === "prefix" && url.startsWith(rule.value)) return true;
    }

    return false;
}

const worker = {
    async fetch(request: Request): Promise<Response> {
        const reqUrl = new URL(request.url);

        if (reqUrl.pathname !== "/external") {
            return new Response("Not found", { status: 404 });
        }

        const method = request.method;
        const isGetOrHead = method === "GET" || method === "HEAD";
        if (!isGetOrHead) {
            return new Response("Method not allowed", { status: 405 });
        }

        const srcParam = reqUrl.searchParams.get("src");
        const srcUrl = (srcParam ?? "").trim();
        if (!srcUrl) {
            return new Response("Missing ?src=", { status: 400 });
        }

        const upstreamUrl = safeHttpsUrl(srcUrl);
        if (upstreamUrl === null) {
            return new Response("Blocked: invalid upstream URL", { status: 403 });
        }

        const rules = await getAllowedRules();
        if (!isAllowedUrl(upstreamUrl, rules)) {
            return new Response("Blocked: src not allowlisted", { status: 403 });
        }

        const upstreamInit: CloudflareRequestInit = {
            method,
            headers: { Accept: "application/javascript,*/*;q=0.1" },
            cf: {
                cacheEverything: true,
                cacheTtl: 60 * 60 * 24,
                cacheKey: `external:${upstreamUrl}`
            }
        };

        const upstreamRes = await fetch(upstreamUrl, upstreamInit);
        if (!upstreamRes.ok) {
            return new Response(`Upstream failed: ${upstreamRes.status}`, { status: 502 });
        }

        const headers = new Headers(upstreamRes.headers);
        headers.set("Content-Type", "application/javascript; charset=utf-8");
        headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Access-Control-Allow-Origin", "*");
        headers.delete("set-cookie");

        return new Response(upstreamRes.body, {
            status: 200,
            headers
        });
    }
} satisfies { fetch: (request: Request) => Promise<Response> };

export default worker;