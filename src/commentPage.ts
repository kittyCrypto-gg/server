/**
 * Canonicalise a page identifier used by the comment system while preserving
 * the query string exactly. Clean routes, trailing slashes and legacy .html
 * routes therefore share one comment section.
 */
export function normaliseCommentPage(page: string): string {
    const trimmed = page.trim();
    if (!trimmed) return "";

    const queryIndex = trimmed.indexOf("?");
    const rawPath = queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex);
    const query = queryIndex === -1 ? "" : trimmed.slice(queryIndex);

    let pathname = rawPath.replace(/\/+$/, "");
    if (!pathname) pathname = "/";

    pathname = pathname.replace(/\.html$/i, "");
    if (!pathname) pathname = "/";

    if (pathname === "/index") pathname = "/";

    return `${pathname}${query}`;
}
