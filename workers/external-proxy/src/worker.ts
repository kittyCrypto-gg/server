type CfCacheOptions = {
    cacheEverything?: boolean;
    cacheTtl?: number;
    cacheKey?: string;
};

type CloudflareRequestInit = RequestInit & {
    cf?: CfCacheOptions;
};

const ALLOWLIST_URL = "https://srv.kittycrypto.gg/allowedSources.json";
const ALLOWLIST_TTL_MS = 60_000;

let cachedAllowlist: Set<string> | null = null;
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

function emptyAllowlist(): Set<string> {
    cachedAllowlist = new Set<string>();
    cachedAtMs = Date.now();
    return cachedAllowlist;
}

async function getAllowedUrls(): Promise<Set<string>> {
    const now = Date.now();
    if (cachedAllowlist !== null && now - cachedAtMs < ALLOWLIST_TTL_MS) return cachedAllowlist;

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

        cachedAllowlist = new Set<string>(sources);
        cachedAtMs = now;
        return cachedAllowlist;
    } catch {
        return emptyAllowlist();
    } finally {
        clearTimeout(timeoutId);
    }
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

        const upstreamParsed = new URL(upstreamUrl);
        const canonical = upstreamParsed.toString();

        const allowlist = await getAllowedUrls();
        const allowed = allowlist.has(srcUrl) || allowlist.has(canonical);

        if (!allowed) {
            return new Response("Blocked: src not allowlisted", { status: 403 });
        }

        const upstreamInit: CloudflareRequestInit = {
            headers: { Accept: "application/javascript,*/*;q=0.1" },
            cf: {
                cacheEverything: true,
                cacheTtl: 60 * 60 * 24,
                cacheKey: `external:${canonical}`
            }
        };

        const upstreamRes = await fetch(canonical, upstreamInit);

        if (!upstreamRes.ok) {
            return new Response(`Upstream failed: ${upstreamRes.status}`, { status: 502 });
        }

        const headers = new Headers(upstreamRes.headers);
        headers.set("Content-Type", "application/javascript; charset=utf-8");
        headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.delete("set-cookie");

        return new Response(upstreamRes.body, { status: 200, headers });
    }
} satisfies { fetch: (request: Request) => Promise<Response> };

export default worker;