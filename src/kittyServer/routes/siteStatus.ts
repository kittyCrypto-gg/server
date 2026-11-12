import type { Request, Response } from "express";
import * as helpers from "../../serverHelpers";
import type { KittyRouteContext } from "./context";

/** Registers existing routes with their original handlers and middleware. */
export function registerSiteStatusRoutes({ server, RateLimiter }: Pick<KittyRouteContext, "server" | "RateLimiter">): void {
server.app.get("/presence",
    async (_req: Request, res: Response) => {
        try {
            const presence = await helpers.getPublicPresence();
            // console.log("📡 Current presence snapshot:", presence);
            res.status(200).json(presence);
        } catch (error) {
            console.error("❌ Error loading presence:", error);
            res.status(502).json({ error: "Failed to load presence." });
        }
    }
);

server.app.get("/website/manifest",
    async (_req: Request, res: Response) => {
        try {
            const manifest = await helpers.readBuildManifest();

            res.setHeader("Cache-Control", "no-store");

            if (manifest === null) {
                res.status(404).json({
                    ok: false,
                    error: "No build manifest found."
                });
                return;
            }

            res.status(200).json(manifest);
        } catch (error) {
            console.error("❌ Error reading website build manifest:", error);
            res.status(500).json({
                ok: false,
                error: "Failed to read build manifest."
            });
        }
    }
);

server.app.post("/website/manifest/update",
    RateLimiter.wrap(
        {
            scope: "website-manifest-update",
            windowMs: 60_000,
            maxAttempts: 5,
            onRejected: (_req, res, decision) => {
                res.status(429).json({
                    ok: false,
                    error: `Too many manifest update requests. Retry in ${String(decision.retryAfterSeconds)} seconds.`
                });
            }
        },
        async (req: Request, res: Response) => {
            try {
                res.setHeader("Cache-Control", "no-store");

                if (!helpers.hasValidBuildKey(req)) {
                    res.status(403).json({
                        ok: false,
                        error: "Forbidden"
                    });
                    return;
                }

                const manifest = await helpers.updateManifest(req.body);

                console.log(
                    `✅ Website build manifest updated with ${String(Object.keys(manifest.files).length)} tracked files.`
                );

                res.status(200).json({
                    ok: true,
                    manifest
                });
            } catch (error) {
                if (error instanceof Error && error.message === "Invalid build manifest payload.") {
                    res.status(400).json({
                        ok: false,
                        error: error.message
                    });
                    return;
                }

                console.error("❌ Error updating website build manifest:", error);
                res.status(500).json({
                    ok: false,
                    error: "Failed to update build manifest."
                });
            }
        }
    )
);

server.app.get("/notices",
    async (_req: Request, res: Response) => {
        try {
            const ntcs = await helpers.readNtcs();

            res.setHeader("Cache-Control", "no-store");

            if (ntcs === null) {
                res.status(200).json([]);
                return;
            }

            res.status(200).json(ntcs);
        } catch (error) {
            console.error("❌ /notices failed:", error);
            res.status(500).json([]);
        }
    }
);

server.app.get("/status",
    (_req: Request, res: Response) => {
        res.status(200).json({
            ok: true,
            online: true,
            now: new Date().toISOString()
        });
    }
);
}
