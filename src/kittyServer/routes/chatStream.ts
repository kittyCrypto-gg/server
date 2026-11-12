import type { Request, Response } from "express";
import * as helpers from "../../serverHelpers";
import type { KittyRouteContext } from "./context";

/** Registers existing routes with their original handlers and middleware. */
export function registerChatStreamRoutes({ server, TokenStore, chat, clients }: Pick<KittyRouteContext, "server" | "TokenStore" | "chat" | "clients">): void {
server.app.get("/chat/stream",
    async (req: Request, res: Response) => {
        try {
            await TokenStore.waitUntilReady();
        } catch {
            res.status(503).json([
                {
                    nick: "system",
                    id: "0x0000000000",
                    msg: "Server initialising. Try again."
                }
            ]);
            return;
        }

        const token = typeof req.query.token === "string" ? req.query.token : "";

        if (!token || !TokenStore.tokenExistsAndValid(token)) {
            res.status(403).json([
                {
                    nick: "system",
                    id: "0x0000000000",
                    msg: "Session expired. Refresh page to reconnect."
                }
            ]);
            return;
        }

        const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
        const hasKey = helpers.originAllowsDecrypted(origin, server);

        await helpers.openChatStream({
            req,
            res,
            token,
            tokenStore: TokenStore,
            chat,
            clients,
            hasKey
        });
    }
);

}
