import type { Request, Response } from "express";
import * as helpers from "../../serverHelpers";
import fs from "fs";
import type { KittyRouteContext } from "./context";

/** Registers existing routes with their original handlers and middleware. */
export function registerContentRoutes({ server, storiesRoot, sitesToMap }: Pick<KittyRouteContext, "server" | "storiesRoot" | "sitesToMap">): void {
server.app.get('/robots.txt',
    (req, res) => { // Serve robots.txt
        res.type('text/plain');
        res.send(
            `User-agent: *
            Disallow:
            Sitemap: https://srv.kittycrypto.gg/sitemap.xml
            Host: nojs.kittycrypto.gg`
        );
    }
);

server.app.get("/stories.json",
    async (_req: Request, res: Response) => {
        try {
            const index = await helpers.exploreStories(storiesRoot);
            res.json(index);
        } catch {
            res.status(500).json({ error: "Failed to generate stories index." });
        }
    }
);

server.app.get(/^\/stories\/(.+)$/,
    async (req: Request, res: Response) => {
        const rest = req.params[0] ?? "";
        const filePath = await helpers.resolveStoryPath(rest, storiesRoot);

        if (!filePath) {
            res.status(404).send("Not found.");
            return;
        }

        if (filePath.toLowerCase().endsWith(".xml")) {
            res.type("application/xml");
            fs.createReadStream(filePath).pipe(res);
            return;
        }

        res.sendFile(filePath);
    }
);

server.app.get(["/sitemap.xml", "/website/sitemap.xml"],
    async (req, res) => {
        return helpers.genSiteMap(sitesToMap, res);
    }
);

}
