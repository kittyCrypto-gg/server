import { Request, Response } from "express";
import fs from "fs";
import Server from "./baseServer";

class KittyRequest<T extends object> {
    protected server: Server;
    protected jsonFilePath: string;
    protected validateRequest: (data: unknown) => data is T;
    protected static sessionTokens: Set<string>;

    constructor(
        server: Server,
        jsonFilePath: string,
        sessionTokens: Set<string>,
        validateRequest: (data: unknown) => data is T
    ) {
        this.server = server;
        this.jsonFilePath = jsonFilePath;
        this.validateRequest = validateRequest;
        KittyRequest.sessionTokens = sessionTokens;
    }


    protected async handleRequest(req: Request, res: Response, action: (req: Request, res: Response, ...args: unknown[]) => Promise<object>, ...args: unknown[]): Promise<Response> {
        const body = req.body;

        if (!body || typeof body !== "object") {
            return res.status(400).json({ error: "Invalid request format." });
        }

        //console.log(`🧳 Active session tokens: {\n  ${Array.from(KittyRequest.sessionTokens).join(",\n  ")}\n}`);

        try {
            const result = await action(req, res, ...args);

            if (!result || typeof result !== "object") {
                console.error("❌ Invalid response from action:", result);
                return res.status(500).json({ error: "Internal Server Error" });
            }

            if (res.headersSent) {
                console.warn("⚠️ Headers already sent, preventing duplicate response.");
                return res; // Prevent duplicate response
            }
            return res.status(200).json(result);

        } catch (error) {
            console.error("❌ Error processing request:", error);

            if (res.headersSent) {
                console.warn("⚠️ Headers already sent, preventing duplicate error response.");
                return res;
            }
            
            // Distinguish different types of errors
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


    public updateSessionTokens(newSessionTokens: Set<string>): void {
        KittyRequest.sessionTokens = newSessionTokens;
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
            } catch (error) {
                console.warn(`Error reading/parsing ${this.jsonFilePath}. Resetting file.`);
                fileData = [];
            }
        }

        fileData.push(data);
        fs.writeFileSync(this.jsonFilePath, JSON.stringify(fileData, null, 2), "utf-8");
    }
}

export default KittyRequest;