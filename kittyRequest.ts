import { Request, Response } from "express";
import fs from "fs";
import Server from "./baseServer";
import { tokenStore } from "./tokenStore";

type TokenLocator = (req: Request) => string | null;

type HandleRequestOpts = {
    requireSessionToken?: boolean;
    getSessionToken?: TokenLocator;
    touchOnValid?: boolean;
};

class KittyRequest<T extends object> {
    protected server: Server;
    protected jsonFilePath: string;
    protected validateRequest: (data: unknown) => data is T;
    protected TokenStore: tokenStore;

    public constructor(
        server: Server,
        jsonFilePath: string,
        TokenStore: tokenStore,
        validateRequest: (data: unknown) => data is T
    ) {
        this.server = server;
        this.jsonFilePath = jsonFilePath;
        this.TokenStore = TokenStore;
        this.validateRequest = validateRequest;
    }
    
    protected async handleRequest(
        req: Request,
        res: Response,
        action: (req: Request, res: Response, ...args: unknown[]) => Promise<object>,
        opts: HandleRequestOpts = {},
        ...args: unknown[]
    ): Promise<Response> {
        const body = req.body;

        if (!body || typeof body !== "object") {
            return res.status(400).json({ error: "Invalid request format." });
        }

        const {
            requireSessionToken = false,
            getSessionToken = (r: Request): string | null => {
                const b = r.body as { sessionToken?: unknown };
                return typeof b?.sessionToken === "string" ? b.sessionToken : null;
            },
            touchOnValid = true,
        } = opts;

        const store = this.TokenStore;

        if (requireSessionToken) {
            if (!store) return res.status(500).json({ error: "Token store not configured." });

            try {
                await store.waitUntilReady();
            } catch {
                return res.status(503).json({ error: "Server initialising. Try again." });
            }

            const token = getSessionToken(req);

            if (!token) {
                return res.status(422).json({ error: "Missing sessionToken." });
            }

            if (!store.tokenExistsAndValid(token)) {
                return res.status(403).json({ error: "Session expired." });
            }

            if (touchOnValid) store.touchToken(token);
        }

        try {
            const result = await action(req, res, ...args);

            if (!result || typeof result !== "object") {
                console.error("❌ Invalid response from action:", result);
                return res.status(500).json({ error: "Internal Server Error" });
            }

            if (res.headersSent) {
                console.warn("⚠️ Headers already sent, preventing duplicate response.");
                return res;
            }

            return res.status(200).json(result);
        } catch (error) {
            console.error("❌ Error processing request:", error);

            if (res.headersSent) {
                console.warn("⚠️ Headers already sent, preventing duplicate error response.");
                return res;
            }

            if (error instanceof Error) {
                if (error.message.includes("Invalid request format")) {
                    return res.status(400).json({ error: error.message });
                }
                if (error.message.includes("Missing")) {
                    return res.status(422).json({ error: error.message });
                }
            }

            return res.status(500).json({ error: "Internal server error." });
        }
    }

    protected saveToFile(data: T): void {
        let fileData: T[] = [];

        if (fs.existsSync(this.jsonFilePath)) {
            try {
                const existingData = fs.readFileSync(this.jsonFilePath, "utf-8");
                fileData = JSON.parse(existingData);
                if (!Array.isArray(fileData)) {
                    throw new Error("Invalid JSON format: Expected an array");
                }
            } catch {
                console.warn(`Error reading/parsing ${this.jsonFilePath}. Resetting file.`);
                fileData = [];
            }
        }

        fileData.push(data);
        fs.writeFileSync(this.jsonFilePath, JSON.stringify(fileData, null, 2), "utf-8");
    }

    public get sessionTokens(): Set<string> {
        return this.TokenStore ? this.TokenStore['sessionTokens'] : new Set<string>();
    }
}

export default KittyRequest;