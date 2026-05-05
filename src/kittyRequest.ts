import { Request, Response } from "express";
import Server from "./baseServer";
import { tokenStore } from "./tokenStore";
import { MutexJsonStore } from "./mutexStore";

type TokenLocator = (req: Request) => string | null;

type HandleRequestOpts = {
    requireSessionToken?: boolean;
    getSessionToken?: TokenLocator;
    touchOnValid?: boolean;
};

class KittyRequest<T extends object> {
    protected server: Server;
    protected validateRequest: (data: unknown) => data is T;
    protected TokenStore: tokenStore;
    private readonly jsonStore: MutexJsonStore<T[]>;

    public constructor(
        server: Server,
        jsonFilePath: string,
        TokenStore: tokenStore,
        validateRequest: (data: unknown) => data is T
    ) {
        this.server = server;
        this.TokenStore = TokenStore;
        this.validateRequest = validateRequest;
        this.jsonStore = new MutexJsonStore<T[]>({
            filePath: jsonFilePath,
            initialValue: (): T[] => [],
        });
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
            if (!store) {
                return res.status(500).json({ error: "Token store not configured." });
            }

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

            if (touchOnValid) {
                store.touchToken(token);
            }
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

    protected async readFileData(): Promise<T[]> {
        const stored = await this.jsonStore.read();
        const { data, wasSanitised } = this.sanitiseStoredData(stored as unknown);

        if (wasSanitised) {
            console.warn("⚠️ Invalid JSON store contents detected. Resetting stored data.");
            await this.replaceFileData(data);
        }

        return data;
    }

    protected async replaceFileData(data: T[]): Promise<void> {
        if (!this.isValidStoredData(data)) {
            throw new Error("Invalid file data. Expected an array of valid entries.");
        }

        await this.jsonStore.update(async (): Promise<T[]> => {
            return data;
        });
    }

    protected async updateFileData(
        update: (current: T[]) => T[] | Promise<T[]>
    ): Promise<T[]> {
        return await this.jsonStore.update(async (current: T[]): Promise<T[]> => {
            const { data: sanitisedCurrent, wasSanitised } = this.sanitiseStoredData(
                current as unknown
            );

            if (wasSanitised) {
                console.warn("⚠️ Invalid JSON store contents detected. Rebuilding stored data.");
            }

            const next = await update(sanitisedCurrent);

            if (!this.isValidStoredData(next)) {
                throw new Error("Invalid file data returned from update.");
            }

            return next;
        });
    }

    protected async saveToFile(data: T): Promise<void> {
        if (!this.validateRequest(data)) {
            throw new Error("Invalid entry. Refusing to persist malformed data.");
        }

        await this.updateFileData(async (current: T[]): Promise<T[]> => {
            return [...current, data];
        });
    }

    private sanitiseStoredData(data: unknown): { data: T[]; wasSanitised: boolean } {
        if (!Array.isArray(data)) {
            return { data: [], wasSanitised: true };
        }

        const validEntries = data.filter((entry: unknown): entry is T => {
            return this.validateRequest(entry);
        });

        return {
            data: validEntries,
            wasSanitised: validEntries.length !== data.length,
        };
    }

    private isValidStoredData(data: unknown): data is T[] {
        return Array.isArray(data) && data.every((entry: unknown) => this.validateRequest(entry));
    }

    public get sessionTokens(): Set<string> {
        return this.TokenStore ? this.TokenStore["sessionTokens"] : new Set<string>();
    }
}

export default KittyRequest;