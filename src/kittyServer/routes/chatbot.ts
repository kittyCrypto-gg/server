import type { Request, Response } from "express";
import * as helpers from "../../serverHelpers";
import fs from "fs";
import argon2 from "argon2";
import type { KittyRouteContext } from "./context";

/** Registers existing routes with their original handlers and middleware. */
export function registerChatbotRoutes({ server, CHATBOT_API_KEY, chatbot_PATH }: Pick<KittyRouteContext, "server" | "CHATBOT_API_KEY" | "chatbot_PATH">): void {
server.app.all("/chatbot/register",
    async (req: Request, res: Response) => {
        // console.log("=== /chatbot/register ===");
        // console.log("Method:", req.method);
        // console.log("URL:", req.originalUrl || req.url);
        // console.log("Headers:");

        // for (const [k, v] of Object.entries(req.headers)) {
        //     console.log(`  ${k}:`, v);
        // }

        const apiKey =
            typeof req.query.apikey === "string"
                ? req.query.apikey
                : "";

        //console.log("API key from query:", apiKey || "(missing)")


        // console.log("X-API-Password header:", apiKey || "(missing)");
        // console.log("Expected CHATBOT_API_KEY:", CHATBOT_API_KEY ? "(set)" : "(not set)");

        if (apiKey !== CHATBOT_API_KEY) {
            console.warn("AUTH FAIL: API key mismatch");
            console.warn("  Received:", apiKey);
            console.warn("  Expected:", CHATBOT_API_KEY);
            res.status(403).send("Forbidden");
            return;
        }

        //console.log("AUTH OK");

        res.setHeader("Cache-Control", "no-store");

        if (req.method === "GET") {
            //console.log("Serving registration page (GET)");
            res.type("text/html").send(helpers.registerPage("", apiKey));
            return;
        }

        if (req.method !== "POST") {
            console.warn("Unsupported method:", req.method);
            res.status(405).send("Method Not Allowed");
            return;
        }

        try {
            //console.log("POST body:", req.body);

            const username = String(req.body?.username || "").trim();
            const password = String(req.body?.password || "");
            const bodyApiKey = String(req.body?.apiKey || "").trim();

            // console.log("Parsed fields:");
            // console.log("  username:", username || "(empty)");
            // console.log("  password length:", password.length);
            // console.log("  apiKey (hidden field):", bodyApiKey || "(empty)");

            if (!username || !password) {
                console.warn("VALIDATION FAIL: Missing username or password");
                res.type("text/html").send(helpers.registerPage("Missing fields", apiKey));
                return;
            }

            //console.log("Hashing password...");
            const hash = await argon2.hash(password, {
                type: argon2.argon2id,
                memoryCost: 64 * 1024,
                timeCost: 3,
                parallelism: 1,
                hashLength: 64
            });

            //console.log("Password hashed");

            //console.log("Updating users file:", chatbot_PATH);

            await helpers.updateUsersFile(doc => {
                if (!Array.isArray(doc.users)) {
                    //console.log("Users array missing, creating new one");
                    doc.users = [];
                }

                if (doc.users.find((u: any) => u.username === username)) {
                    console.warn("USER EXISTS:", username);
                    throw new Error("User already exists");
                }

                //console.log("Adding user:", username);
                doc.users.push({ username, hash });
            });

            //console.log("USER CREATED SUCCESSFULLY:", username);

            //console.log("Registration complete, redirecting to chat")

            res.redirect(302, "https://chat.kittycrypto.gg");

        } catch (err) {
            console.error("REGISTER ERROR:", err);
            console.error("Stack:", (err as any)?.stack);
            res.type("text/html").send(
                helpers.registerPage("Registration failed", apiKey)
            );
        } finally {
            //console.log("=== /chatbot/register END ===");
        }
    }
);

server.app.post("/chatbot/authenticate",
    async (req: Request, res: Response) => {
        const raw = req.headers["x-api-password"]
        const apiKey = Array.isArray(raw) ? raw[0] : raw

        if (apiKey !== CHATBOT_API_KEY) {
            res.status(403).json({ ok: false })
            return
        }

        try {
            const { username, password } = req.body || {}

            if (typeof username !== "string" || typeof password !== "string") {
                res.status(400).json({ ok: false })
                return
            }

            const raw = await fs.promises.readFile(chatbot_PATH, "utf8")
            const parsed = JSON.parse(raw)

            if (!Array.isArray(parsed.users)) {
                throw new Error("Invalid users file")
            }

            const user = parsed.users.find((u: any) => u.username === username)

            if (!user || typeof user.hash !== "string") {
                res.json({ ok: false })
                return
            }

            const ok = await argon2.verify(user.hash, password)

            if (ok) {
                res.json({ ok: true, username })
                return
            }

            res.json({ ok: false })
        } catch (err) {
            console.error("❌ /chatbot/authenticate failed:", err)
            res.status(500).json({ ok: false })
        }
    }
);

}
