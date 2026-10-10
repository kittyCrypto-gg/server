import { canonicalHref, appIdFromHref } from "./routes";
import type { DiscoveredApp, AppDescriptions } from "./types";

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
