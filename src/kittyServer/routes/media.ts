import type { Request, Response } from "express";
import * as helpers from "../../serverHelpers";
import { renderPage } from "../../render";
import type { KittyRouteContext } from "./context";

/** Registers existing routes with their original handlers and middleware. */
export function registerMediaRoutes({ server, imageTransformer, RENDER_TOKEN }: Pick<KittyRouteContext, "server" | "imageTransformer" | "RENDER_TOKEN">): void {
server.app.get("/img",
    async (req: Request, res: Response) => {
        const parsed = helpers.parseImgQuery(req);

        if (!parsed.ok) {
            res.status(parsed.httpStatus).send(parsed.message);
            return;
        }

        const baseUrl = helpers.buildRequestBaseUrl(req);

        try {
            const result = await imageTransformer.transformRemoteUrl({
                src: parsed.src,
                baseUrl,
                format: parsed.format ?? undefined,
                srcFormatHint: parsed.srcFormatHint ?? undefined,
                resize: parsed.resize,
            });

            helpers.sendImgResult(res, result);
        } catch (err) {
            helpers.sendImgError(res, err);
        }
    }
);

server.app.get("/render",
    async (req: Request, res: Response) => {
        //console.log(`Hit on /render from ${helpers.getClientIp(req)}`);
        const token = req.header("x-render-token")?.trim() || "";

        if (RENDER_TOKEN && token !== RENDER_TOKEN) {
            res.status(403).send("Forbidden");
            console.warn(`Unauthorised render attempt with token: ${token}`);
            return;
        }

        const readString = (value: unknown): string => {
            //console.log(`Reading value:`, value);
            return typeof value === "string" ? value.trim() : "";
        };

        const url =
            req.method === "GET"
                ? readString(req.query.url)
                : readString((req.body as { url?: unknown } | undefined)?.url);

        const waitForSelector =
            req.method === "GET"
                ? readString(req.query.waitForSelector)
                : readString((req.body as { waitForSelector?: unknown } | undefined)?.waitForSelector);

        if (!url) {
            res.status(400).send("Missing url");
            console.warn(`Bad /render request: missing url. Received token: ${token}`);
            return;
        }

        try {
            const result = await renderPage(
                {
                    url,
                    waitForSelector: waitForSelector || undefined
                },
                {
                    token: RENDER_TOKEN || undefined,
                    allowedOrigins: ["https://kittycrypto.gg", "https://kittycrow.dev"],
                }
            );
            //console.log(`Render successful for ${url}, final URL: ${result.finalUrl}`);

            res.status(result.status);
            res.setHeader("Content-Type", "text/html; charset=UTF-8");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Render-Final-Url", result.finalUrl);
            res.send(result.html);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).send(`Render failed: ${message}`);
            console.warn(`Render failed for ${url}. Received token: ${token}. Error: ${message}`);
        }
    }
);

}
