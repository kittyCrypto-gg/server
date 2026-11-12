import type { Request, Response, NextFunction } from "express";

function hasUrlScheme(value: string): boolean {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function safeDecodeUriComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function isValidExternalHostname(hostname: string): boolean {
    const normalisedHostname = hostname
        .trim()
        .toLowerCase()
        .replace(/\.$/, "");

    if (!normalisedHostname) {
        return false;
    }

    if (!normalisedHostname.includes(".")) {
        return false;
    }

    const labels = normalisedHostname.split(".");

    if (labels.some((label) => !label)) {
        return false;
    }

    return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

export function normVisitOrig(value: string): string {
    const decoded = safeDecodeUriComponent(value).trim();

    if (!decoded) {
        throw new Error("A site origin is required.");
    }

    const candidate = hasUrlScheme(decoded)
        ? decoded
        : `https://${decoded}`;

    const url = new URL(candidate);

    if (url.protocol !== "https:") {
        throw new Error("Site origin must use HTTPS.");
    }

    if (url.username || url.password) {
        throw new Error("Site origin must not include credentials.");
    }

    if (url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Site origin must not include a path, query, or hash.");
    }

    if (!isValidExternalHostname(url.hostname)) {
        throw new Error("Site origin must include a valid hostname with a TLD.");
    }

    return url.origin;
}

function getRouteOrig(req: Request): string {
    const rawSite = typeof req.params.site === "string" ? req.params.site.trim() : "";

    if (!rawSite) {
        return "";
    }

    try {
        return normVisitOrig(rawSite);
    } catch {
        return "";
    }
}

function getReqOrig(req: Request): string {
    const rawOrigin = req.header("origin")?.trim() ?? "";

    if (!rawOrigin) {
        return "";
    }

    try {
        return normVisitOrig(rawOrigin);
    } catch {
        return "";
    }
}

export function normVstSiteParam(req: Request, res: Response, next: NextFunction): void {
    const siteOrigin = getRouteOrig(req);

    if (!siteOrigin) {
        res.status(400).json({
            error: "A valid HTTPS site origin or hostname with a TLD is required."
        });
        return;
    }

    req.params.site = siteOrigin;

    next();
}

export function matchOrig(req: Request, res: Response, next: NextFunction): void {
    const siteOrigin = getRouteOrig(req);
    const requestOrigin = getReqOrig(req);

    if (!siteOrigin) {
        res.status(400).json({ error: "A valid site origin is required." });
        return;
    }

    if (!requestOrigin) {
        res.status(403).json({ error: "A browser Origin header is required." });
        return;
    }

    if (requestOrigin !== siteOrigin) {
        res.status(403).json({ error: "Visit origin does not match request origin." });
        return;
    }

    req.params.site = siteOrigin;

    next();
}
