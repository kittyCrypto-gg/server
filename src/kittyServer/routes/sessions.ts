import cors from "cors";
import type { Request, Response } from "express";
import * as helpers from "../../serverHelpers";
import type { KittyRouteContext } from "./context";

/** Registers existing routes with their original handlers and middleware. */
export function registerSessionRoutes({ server, TokenStore, chat }: Pick<KittyRouteContext, "server" | "TokenStore" | "chat">): void {
server.app.get("/session-token",
    async (req: Request, res: Response) => {

        try {
            await TokenStore.waitUntilReady();
        } catch {
            res.status(503).json({ error: "Server initialising. Try again." });
            return;
        }

        const sessionToken = helpers.generateSessionToken();
        TokenStore.touchToken(sessionToken);
        res.json({ sessionToken });
    }
);

server.app.post("/session-token/reregister",
    async (req: Request, res: Response) => {
        try {
            await TokenStore.waitUntilReady();
        } catch {
            res.status(503).json({ error: "Server initialising. Try again." });
            return;
        }

        const sessionToken = typeof req.body?.sessionToken === "string" ? req.body.sessionToken : "";

        if (!sessionToken) {
            res.status(422).json({ error: "Missing sessionToken." });
            return;
        }

        if (!TokenStore.tokenExistsAndValid(sessionToken)) {
            res.status(403).json({ error: "Session expired." });
            return;
        }

        TokenStore.touchToken(sessionToken);

        res.status(200).json({
            ok: true,
            sessionToken,
            expiresAtMs: TokenStore.getExpiryMs(sessionToken),
        });
    }
);

server.app.get("/get-ip", cors({ origin: "*" }),
    (req: Request, res: Response) => {
        res.json({ ip: helpers.getClientIp(req) });
    }
);

server.app.get("/get-ip/sha256", cors({ origin: "*" }),
    (req: Request, res: Response) => {
        try {
            const hashedId = chat.generateUserId(helpers.getClientIp(req));
            res.json({ hashedIp: hashedId });
        } catch (error) {
            console.error("❌ Error hashing IP:", error);
            res.status(500).json({ error: "Failed to hash IP address." });
        }
    }
);

}
