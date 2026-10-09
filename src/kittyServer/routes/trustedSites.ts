import type { Request, Response } from "express";
import * as helpers from "../../serverHelpers";
import type { KittyRouteContext } from "./context";

/** Registers existing routes with their original handlers and middleware. */
export function registerTrustedSiteRoutes({ server, RateLimiter, trustedSites, BASE_URL }: Pick<KittyRouteContext, "server" | "RateLimiter" | "trustedSites" | "BASE_URL">): void {
server.app.post("/verify/register/:site",
    RateLimiter.wrap(
        {
            scope: "trusted-sites-register",
            windowMs: 60_000,
            maxAttempts: 10,
            resolveBucketKey: (req: Request): string => {
                return helpers.getClientIp(req);
            },
            onRejected: (_req, res, decision) => {
                res.status(429).json({
                    ok: false,
                    error: `Too many verification registration requests. Retry in ${String(decision.retryAfterSeconds)} seconds.`
                });
            }
        },
        async (req: Request, res: Response) => {
            try {
                const site = trustedSites.readSiteParam(req.params.site);

                const result = await trustedSites.reg({
                    site,
                    srvBaseUrl: BASE_URL
                });

                res.setHeader("Cache-Control", "no-store");
                res.status(200).json({
                    ok: true,
                    ...result
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Failed to register verification challenge.";

                console.error("❌ Error registering trusted site challenge:", error);
                res.status(400).json({
                    ok: false,
                    error: message
                });
            }
        }
    )
);

server.app.get("/verify/:site/kittycrow.key",
    async (req: Request, res: Response) => {
        try {
            const site = trustedSites.readSiteParam(req.params.site);
            const keyFile = trustedSites.key({ site });

            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Type", keyFile.contentType);
            res.setHeader("Content-Disposition", `attachment; filename="${keyFile.fileName}"`);
            res.setHeader("X-Kittycrow-Key-Sha256", keyFile.keyFileSha256);
            res.status(200).send(keyFile.body);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to generate verification key file.";

            console.error("❌ Error generating trusted site key file:", error);
            res.status(404).json({
                ok: false,
                error: message
            });
        }
    }
);

server.app.post("/verify/:site",
    RateLimiter.wrap(
        {
            scope: "trusted-sites-check",
            windowMs: 60_000,
            maxAttempts: 10,
            resolveBucketKey: (req: Request): string => {
                return helpers.getClientIp(req);
            },
            onRejected: (_req, res, decision) => {
                res.status(429).json({
                    ok: false,
                    error: `Too many verification check requests. Retry in ${String(decision.retryAfterSeconds)} seconds.`
                });
            }
        },
        async (req: Request, res: Response) => {
            try {
                const site = trustedSites.readSiteParam(req.params.site);

                const result = await trustedSites.chk({ site });

                res.setHeader("Cache-Control", "no-store");

                if (!result.verified) {
                    res.status(422).json({
                        ok: false,
                        ...result
                    });
                    return;
                }

                res.status(200).json({
                    ok: true,
                    ...result
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Failed to verify trusted site.";

                console.error("❌ Error checking trusted site verification:", error);
                res.status(400).json({
                    ok: false,
                    error: message
                });
            }
        }
    )
);

}
