/* @ts-ignore */
import "dotenv/config";
import { getRefreshMs } from "./appDiscovery/config";
import { discoverGithubApps } from "./appDiscovery/github";
import { discoverLocalApps } from "./appDiscovery/nginx";
import { refreshAppDescriptions } from "./appDiscovery/descriptions";
import { mergeDiscoveredApps, applyAppDescriptions } from "./appDiscovery/merge";
import type { AppDiscoverySnapshot } from "./appDiscovery/types";

export type { AppSource, AppDescriptions, DiscoveredApp, AppDiscoverySnapshot } from "./appDiscovery/types";
export { appIdFromHref } from "./appDiscovery/routes";
export { parseLocalAppsFromNginx } from "./appDiscovery/nginx";
export { githubRepoToApp, isGithubPagesReachable } from "./appDiscovery/github";
export { mergeDiscoveredApps, applyAppDescriptions } from "./appDiscovery/merge";

let currentSnapshot: AppDiscoverySnapshot = {
    generatedAt: null,
    apps: []
};

let refreshInFlight: Promise<AppDiscoverySnapshot> | null = null;
let discoveryStarted = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
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
