import type { Request, Response } from "express";
import type Server from "../baseServer";
import * as appDiscovery from "../appDiscovery";

export function registerAppDiscoveryEndpoint(server: Server): void {
    server.addPubCorsRte("/apps", "GET");

    server.app.get("/apps", (_req: Request, res: Response) => {
        const snapshot = appDiscovery.getAppDiscoverySnapshot();

        if (snapshot.generatedAt === null) {
            res.setHeader("Cache-Control", "no-store");
            res.status(503).json({
                ...snapshot,
                error: "App discovery is still initialising."
            });
            return;
        }

        res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
        res.status(200).json(snapshot);
    });

    void appDiscovery.startAppDiscovery().catch((error: unknown) => {
        console.error("❌ Failed to start app discovery:", error);
    });
}
