import path from "path";
import Server from "./baseServer";
import Chat from "./kittyChat";
import Comment from "./kittyComment";
import { CommentData } from "./kittyComment";
import cors from "cors";
import fs from "fs";
import { Request, Response } from "express";
import KittyRequest from "./kittyRequest";
import * as ImageTransformer from "./imageTransformer";
import fetch from "node-fetch"
import { tokenStore } from "./tokenStore";
import argon2 from "argon2"
import express from "express"
import { renderPage } from "./render";
import * as types from "./types";
import * as helpers from "./serverHelpers";
/* @ts-ignore */
import "dotenv/config"

const HOST = process.env.HOST;
const PORT = parseInt(process.env.PORT || "0");
const chatbot_PATH = path.resolve(process.cwd(), "data", "chatbot_users.gcm.json")
const CHATBOT_API_KEY = process.env.CHATBOT_API_KEY
const RENDER_TOKEN = process.env.RENDER_TOKEN || "";
const clients: types.SseClient[] = [];
const imageTransformer = new ImageTransformer.ImageTransformer();
const chat_json_path = path.resolve(process.cwd(), "data", "chat.gcm.json");
const comments_json_path = path.resolve(process.cwd(), "data", "comments.json");
const allowedOrigins = [
    "https://kittycrypto.gg",
    "https://nojs.kittycrypto.gg",
    "https://test.kittycrypto.gg",
    "https://api.kittycrypto.gg",
    "https://app.kittycrypto.gg",
    "https://chat.kittycrypto.gg",
    "https://srv.kittycrypto.gg",
    "https://kittycrypto-gg.translate.goog",
    "http://localhost:8000",
];

const sitesToMap = new Set<string>([
    "",
    "about.html",
    "blog.html",
    "chat.html",
    "reader.html"
])

if (typeof globalThis.fetch !== "function") {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetch;
}

if (!HOST) {
    console.error("❌ HOST environment variable is not set. Exiting.");
    process.exit(1);
}

if (isNaN(PORT) || PORT <= 0 || PORT > 65535) {
    console.error("❌ PORT environment variable is not set or invalid. Exiting.");
    process.exit(1);
}

if (!CHATBOT_API_KEY) {
    console.error("❌ CHATBOT_API_KEY not set")
    process.exit(1)
}

// Initialise the HTTPS server
const server = new Server(HOST, PORT, allowedOrigins);

server.app.use(express.urlencoded({ extended: false }))
server.app.use(express.json())
server.app.set("trust proxy", true)

// Session store to track active sessions
const sessionTokens = new Set<string>();

const TokenStore = new tokenStore(
    server,
    sessionTokens,
    (_tokens) => { }
);

TokenStore.init();

const chat = new Chat(server, chat_json_path, TokenStore);
const comment = new Comment(server, comments_json_path, TokenStore);

const allowedSourcesPath = path.resolve(process.cwd(), "data", "allowedSources.json");

const storiesRoot = path.resolve(process.cwd(), "stories");

// Endpoint to request a session token
server.app.get("/session-token", async (req: Request, res: Response) => {

    try {
        await TokenStore.waitUntilReady();
    } catch {
        res.status(503).json({ error: "Server initialising. Try again." });
        return;
    }

    const sessionToken = helpers.generateSessionToken();
    TokenStore.touchToken(sessionToken);
    res.json({ sessionToken });
});

// Endpoint to reregister (keep alive) a session token
server.app.post("/session-token/reregister", async (req: Request, res: Response) => {
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
});

// Endpoint: Get Raw IP
server.app.get("/get-ip", cors({ origin: "*" }), (req: Request, res: Response) => {
    res.json({ ip: helpers.getClientIp(req) });
});

// Endpoint: Get Hashed IP
server.app.get("/get-ip/sha256", cors({ origin: "*" }), (req: Request, res: Response) => {
    try {
        const hashedId = chat.generateUserId(helpers.getClientIp(req));
        res.json({ hashedIp: hashedId });
    } catch (error) {
        console.error("❌ Error hashing IP:", error);
        res.status(500).json({ error: "Failed to hash IP address." });
    }
});

// Endpoint: SSE Stream for Chat Updates
server.app.get("/chat/stream", async (req: Request, res: Response) => {

    try {
        await TokenStore.waitUntilReady();
    } catch {
        res.status(503).json([{ nick: "system", id: "0x0000000000", msg: "Server initialising. Try again." }]);
        return;
    }

    const token = req.query.token as string | undefined;

    if (!token || !TokenStore.tokenExistsAndValid(token)) {
        res.status(403).json([{ nick: "system", id: "0x0000000000", msg: "Session expired. Refresh page to reconnect." }]);
        return;
    }

    TokenStore.touchToken(token);

    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const wantsDecrypted = helpers.originAllowsDecrypted(origin, server);

    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Content-Encoding", "identity");
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const initial = wantsDecrypted ? chat.loadAndDecryptChat() : chat.loadEncryptedChat();
    res.write(`data: ${JSON.stringify(initial)}\n\n`);

    clients.push({ res, hasKey: wantsDecrypted });

    req.on("close", () => {
        const idx = clients.findIndex(c => c.res === res);
        if (idx !== -1) clients.splice(idx, 1);
    });
});

// Endpoint: Get comments
server.app.get("/comments/load", (req: Request, res: Response) => {
    (async () => {
        const page = decodeURIComponent(req.query.page as string);
        console.log("🔍 Loading comments for page:", page);

        if (!page || typeof page !== "string") {
            return res.status(400).json({ error: "Missing or invalid 'page' query parameter." });
        }

        try {
            if (!await fs.promises.stat(comments_json_path).then(() => true).catch(() => false)) {
                return res.status(200).json([]);
            }

            const rawData = await fs.promises.readFile(comments_json_path, "utf-8");
            const allComments = JSON.parse(rawData);

            //console.log(`📜 Loaded ${allComments.length} comments from ${comments_json_path}`);
            //console.log(`🔍 All comments: ${JSON.stringify(allComments)}`);

            if (!Array.isArray(allComments)) {
                throw new Error("Invalid comment store format.");
            }


            const matchingComments = allComments.filter((c: CommentData) => c.page === page);

            console.log(`📜 Found ${matchingComments.length} comments for page: ${page}`);
            //console.log(`🔍 Matching comments: ${JSON.stringify(matchingComments)}`);

            res.status(200).json(matchingComments);
        } catch (error) {
            console.error("❌ Error retrieving comments:", error);
            res.status(500).json({ error: "Failed to load comments." });
        }
    })();
});

// Modify Chat to Call `notifyClients()` When New Messages Arrive
chat.onNewMessage = () => helpers.notifyClients(chat, clients);

server.app.get('/robots.txt', (req, res) => { // Serve robots.txt
    res.type('text/plain');
    res.send(
        `User-agent: *
            Disallow:
            Sitemap: https://srv.kittycrypto.gg/sitemap.xml
            Host: nojs.kittycrypto.gg`
    );
});

server.app.get("/stories.json", async (_req: Request, res: Response) => {
    try {
        const index = await helpers.exploreStories(storiesRoot);
        res.json(index);
    } catch {
        res.status(500).json({ error: "Failed to generate stories index." });
    }
});

server.app.get(/^\/stories\/(.+)$/, async (req: Request, res: Response) => {
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
});

server.app.get(["/sitemap.xml", "/website/sitemap.xml"], async (req, res) => {
    return helpers.genSiteMap(sitesToMap, res);
});

server.app.get("/allowedSources.json", async (_req: Request, res: Response) => {
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
});

server.app.all("/chatbot/register", async (req: Request, res: Response) => {
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
});

server.app.post("/chatbot/authenticate", async (req: Request, res: Response) => {
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
})

server.app.get("/img", async (req: Request, res: Response) => {
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
});

server.app.get("/render", async (req: Request, res: Response) => {
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
                allowedOrigins: ["https://kittycrypto.gg"]
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
});

server.app.get("/status", (_req: Request, res: Response) => {
    res.status(200).json({
        ok: true,
        online: true,
        now: new Date().toISOString()
    });
});

server.start();
helpers.trackChatChanges(chat_json_path, chat, clients);

console.log(chat.readyMessage());
console.log(comment.readyMessage());

console.log(`🚀 Kitty Server is running on https://${HOST}:${PORT}`);

//blogger.runOnceNow();