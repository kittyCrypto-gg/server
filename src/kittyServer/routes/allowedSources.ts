import type { Request, Response } from "express";
import fs from "fs";
import type { KittyRouteContext } from "./context";

/** Registers existing routes with their original handlers and middleware. */
export function registerAllowedSourceRoutes({ server, allowedSourcesPath }: Pick<KittyRouteContext, "server" | "allowedSourcesPath">): void {
server.app.get("/allowedSources.json",
    async (_req: Request, res: Response) => {
        try {
            const raw = await fs.promises.readFile(allowedSourcesPath, "utf-8");
            const parsed = JSON.parse(raw);

            const list = parsed && Array.isArray(parsed.sources)
                ? parsed.sources
                : [];

            const set = new Set<string>();

            for (const value of list) {
                if (typeof value !== "string") continue;

                let u: URL;
                try {
                    u = new URL(value);
                } catch {
                    continue;
                }

                if (u.protocol !== "https:") continue;
                if (u.username || u.password) continue;

                set.add(u.toString());
            }

            res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
            res.json({
                updatedAt: new Date().toISOString(),
                sources: Array.from(set)
            });
        } catch (err) {
            console.error("❌ /allowedSources.json failed:", err);
            res.status(500).json({
                error: "Failed to load allowlist",
                sources: []
            });
        }
    }
);

}
