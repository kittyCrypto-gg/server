export function canonicalHref(value: string): string {
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
export function humaniseRoute(href: string): string {
    const path = href.replace(/^\/+|\/+$/g, "");
    const lastSegment = path.split("/").filter(Boolean).pop() || "App";

    return lastSegment
        .replace(/[-_]+/g, " ")
        .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
