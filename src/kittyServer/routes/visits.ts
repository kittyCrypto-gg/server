import type { Request, Response } from "express";
import * as helpers from "../../serverHelpers";
import type { KittyRouteContext } from "./context";

/** Registers existing routes with their original handlers and middleware. */
export function registerVisitRoutes({ server, RateLimiter, trustedSites, BASE_URL, visits, externalVisits }: Pick<KittyRouteContext, "server" | "RateLimiter" | "trustedSites" | "BASE_URL" | "visits" | "externalVisits">): void {
server.app.post("/visits/log",
    async (req: Request, res: Response) => {
        try {
            const ip = helpers.getClientIp(req)
            const bodyPage = typeof req.body?.page === "string" ? req.body.page : ""
            const fallbackPage = helpers.readVisitSource(req)
            const page = bodyPage.trim() || fallbackPage.trim()

            if (!page) {
                res.status(400).json({ error: "A page path is required to log a visit." })
                return
            }

            const result = await visits.logVisit(ip, page)
            res.status(200).json(result)
        } catch (error) {
            console.error("❌ Error logging visit:", error)
            res.status(500).json({ error: "Failed to log visit." })
        }
    }
);

server.app.get("/visits/stats",
    async (req: Request, res: Response) => {
        try {
            const page = typeof req.query.page === "string" ? req.query.page : ""

            if (page.trim()) {
                const stats = await visits.getPageStats(page)
                res.status(200).json(stats)
                return
            }

            const stats = await visits.getStats()
            res.status(200).json(stats)
        } catch (error) {
            console.error("❌ Error loading visit stats:", error)
            res.status(500).json({ error: "Failed to load visit stats." })
        }
    }
);

server.app.post("/visits/log/:site",
    helpers.matchOrig,
    RateLimiter.wrap(
        {
            scope: "external-visits-log",
            windowMs: 60_000,
            maxAttempts: 60,
            resolveOriginKey: (req: Request): string => {
                return typeof req.params.site === "string" ? req.params.site.trim() : "";
            },
            resolveBucketKey: (req: Request): string => {
                return helpers.getClientIp(req);
            },
            onRejected: (_req, res, decision) => {
                res.status(429).json({
                    ok: false,
                    error: `Too many visit log requests. Retry in ${String(decision.retryAfterSeconds)} seconds.`
                });
            }
        },
        async (req: Request, res: Response) => {
            try {
                const site = typeof req.params.site === "string" ? req.params.site : "";
                const encodedSite = encodeURIComponent(site);
                const ip = helpers.getClientIp(req);
                const bodyPage = typeof req.body?.page === "string" ? req.body.page : "";
                const fallbackPage = helpers.readVisitSource(req);
                const page = bodyPage.trim() || fallbackPage.trim();

                if (!site.trim()) {
                    res.status(400).json({ error: "A site is required to log a visit." });
                    return;
                }

                if (!page) {
                    res.status(400).json({ error: "A page path is required to log a visit." });
                    return;
                }

                const trusted = await trustedSites.isTrst(site);

                if (!trusted) {
                    res.status(403).json({
                        ok: false,
                        error: `This site is not registered for public visit tracking. Register it first using \
                        ${BASE_URL}/verify/register/${encodedSite}, upload the generated kittycrow.key file to \
                        ${site}/.well-known/kittycrow.key, then verify it with ${BASE_URL}/verify/${encodedSite}.`
                        .replace(/\s+/g, " ").trim()
                    });
                    return;
                }

                const result = await externalVisits.logVisit(site, ip, page);

                res.status(200).json(result);
            } catch (error) {
                console.error("❌ Error logging external visit:", error);
                res.status(500).json({ error: "Failed to log visit." });
            }
        }
    )
);

server.app.get("/visits/stats/:site",
    helpers.matchOrig,
    async (req: Request, res: Response) => {
        try {
            const site = typeof req.params.site === "string" ? req.params.site : "";
            const encodedSite = encodeURIComponent(site);
            const page = typeof req.query.page === "string" ? req.query.page : "";

            if (!site.trim()) {
                res.status(400).json({ error: "A site is required to load visit stats." });
                return;
            }

            const trusted = await trustedSites.isTrst(site);

            if (!trusted) {
                res.status(403).json({
                    ok: false,
                    error: `This site is not registered for public visit tracking. Register it first using \
                    ${BASE_URL}/verify/register/${encodedSite}, upload the generated kittycrow.key file to \
                    ${site}/.well-known/kittycrow.key, then verify it with ${BASE_URL}/verify/${encodedSite}.`
                    .replace(/\s+/g, " ").trim()
                });
                return;
            }

            if (page.trim()) {
                const stats = await externalVisits.getPageStats(site, page);

                res.status(200).json(stats);
                return;
            }

            const stats = await externalVisits.getStats(site);

            res.status(200).json(stats);
        } catch (error) {
            console.error("❌ Error loading external visit stats:", error);
            res.status(500).json({ error: "Failed to load visit stats." });
        }
    }
);

}
