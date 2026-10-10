import fs from "fs";
import { getNginxConfigPath } from "./config";
import { canonicalHref, appIdFromHref, humaniseRoute } from "./routes";
import type { DiscoveredApp } from "./types";

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
export async function discoverLocalApps(): Promise<DiscoveredApp[]> {
    const config = await fs.promises.readFile(getNginxConfigPath(), "utf8");
    return parseLocalAppsFromNginx(config);
}
