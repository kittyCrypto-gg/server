interface Env {
    TARGET_ORIGIN?: string;
    RENDER_ENDPOINT: string;
    RENDER_TOKEN?: string;
}

const HTML_TTL = 300;
const ASSET_RE =
    /\.(?:avif|bmp|css|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|png|svg|txt|web[mp]|woff2?|xml)$/i;

function getOrigin(request: Request, env: Env): string {
    const fixedOrigin = env.TARGET_ORIGIN?.trim();

    if (fixedOrigin) {
        return fixedOrigin;
    }

    const url = new URL(request.url);
    const host = url.hostname.replace(/^(?:render|nojs)\./, "");

    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`;
}

function hasAuthCookie(request: Request): boolean {
    const cookie = request.headers.get("cookie") ?? "";

    if (cookie === "") {
        return false;
    }

    return /(?:^|;\s*)(?:session|auth|token|jwt|logged_in|connect\.sid|next-auth\.session-token)=/i.test(cookie);
}

function shouldProxy(request: Request, url: URL): boolean {
    if (ASSET_RE.test(url.pathname)) {
        return true;
    }

    const dest = request.headers.get("sec-fetch-dest") ?? "";
    const accept = request.headers.get("accept") ?? "";
    const wantsHtml = accept.includes("text/html");

    if (dest === "document" || dest === "iframe") {
        return false;
    }

    if (dest !== "") {
        return true;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        return true;
    }

    return !wantsHtml;
}

function canHtmlCache(request: Request, url: URL): boolean {
    if (request.method !== "GET") {
        return false;
    }

    if (url.searchParams.has("__fresh")) {
        return false;
    }

    if (request.headers.has("authorization")) {
        return false;
    }

    if (hasAuthCookie(request)) {
        return false;
    }

    return !shouldProxy(request, url);
}

function rewriteOrigin(headers: Headers, origin: string): void {
    const current = headers.get("origin");

    if (current === null) {
        return;
    }

    headers.set("origin", origin);
}

function rewriteReferer(headers: Headers, origin: string): void {
    const current = headers.get("referer");

    if (current === null) {
        return;
    }

    try {
        const ref = new URL(current);
        const next = new URL(
            `${ref.pathname}${ref.search}${ref.hash}`,
            origin
        );

        headers.set("referer", next.toString());
    } catch {
        headers.delete("referer");
    }
}

function rewriteLocation(
    headers: Headers,
    renderOrigin: string,
    targetOrigin: string
): void {
    const location = headers.get("location");

    if (location === null) {
        return;
    }

    try {
        const absolute = new URL(location, targetOrigin);
        const targetBase = new URL(targetOrigin);

        if (absolute.origin !== targetBase.origin) {
            return;
        }

        const next = new URL(
            `${absolute.pathname}${absolute.search}${absolute.hash}`,
            renderOrigin
        );

        headers.set("location", next.toString());
    } catch {
        // Ignore invalid Location headers.
    }
}

async function proxyReq(
    request: Request,
    url: URL,
    origin: string,
    renderOrigin: string
): Promise<Response> {
    const headers = new Headers(request.headers);

    rewriteOrigin(headers, origin);
    rewriteReferer(headers, origin);

    const upstream = await fetch(url.toString(), {
        method: request.method,
        headers,
        body:
            request.method === "GET" || request.method === "HEAD"
                ? undefined
                : request.body,
        redirect: "manual"
    });

    const nextHeaders = new Headers(upstream.headers);
    rewriteLocation(nextHeaders, renderOrigin, origin);

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: nextHeaders
    });
}

async function fetchRenderedHtml(
    targetUrl: URL,
    env: Env
): Promise<Response> {
    const endpoint = env.RENDER_ENDPOINT?.trim();

    if (!endpoint) {
        throw new Error("Missing RENDER_ENDPOINT.");
    }

    const renderUrl = new URL(endpoint);
    renderUrl.searchParams.set("url", targetUrl.toString());

    const headers = new Headers();

    if (env.RENDER_TOKEN?.trim()) {
        headers.set("x-render-token", env.RENDER_TOKEN.trim());
    }

    return fetch(renderUrl.toString(), {
        method: "GET",
        headers
    });
}

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
    ): Promise<Response> {
        try {
            const inUrl = new URL(request.url);
            const origin = getOrigin(request, env);
            const targetUrl = new URL(`${inUrl.pathname}${inUrl.search}`, origin);

            if (new URL(origin).origin === inUrl.origin) {
                return new Response(
                    "Render failed: target origin resolves to the render host.",
                    {
                        status: 500,
                        headers: {
                            "content-type": "text/plain; charset=UTF-8"
                        }
                    }
                );
            }

            if (shouldProxy(request, inUrl)) {
                return proxyReq(request, targetUrl, origin, inUrl.origin);
            }

            const canCache = canHtmlCache(request, inUrl);
            const edgeCache = await caches.open("render-html");
            const cacheKey = new Request(request.url, request);

            if (canCache) {
                const hit = await edgeCache.match(cacheKey);

                if (hit) {
                    return hit;
                }
            }

            const renderRes = await fetchRenderedHtml(targetUrl, env);
            const body = await renderRes.text();

            const headers = new Headers({
                "content-type":
                    renderRes.headers.get("content-type") ?? "text/html; charset=UTF-8",
                "cache-control":
                    canCache && renderRes.ok
                        ? `public, s-maxage=${HTML_TTL}`
                        : "no-store"
            });

            const finalUrl = renderRes.headers.get("x-render-final-url");
            if (finalUrl) {
                headers.set("x-render-final-url", finalUrl);
            }

            const res = new Response(body, {
                status: renderRes.status,
                headers
            });

            if (canCache && renderRes.ok) {
                ctx.waitUntil(edgeCache.put(cacheKey, res.clone()));
            }

            return res;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            return new Response(`Worker failed: ${message}`, {
                status: 500,
                headers: {
                    "content-type": "text/plain; charset=UTF-8",
                    "cache-control": "no-store"
                }
            });
        }
    }
};