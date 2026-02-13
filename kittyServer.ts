import path from "path";
import Server from "./baseServer";
import Chat from "./kittyChat";
import Renderer from "./kittyWebsite";
import Comment from "./kittyComment";
import { CommentData } from "./kittyComment";
import cors from "cors";
import fs from "fs";
import crypto from "crypto";
import { Request, Response } from "express";
import KittyRequest from "./kittyRequest";
import { GithubAutoScheduler } from "./blogScheduler";
import fetch from "node-fetch"
import { tokenStore } from "./tokenStore";
import argon2 from "argon2"
import express from "express"
/* @ts-ignore */
import "dotenv/config"


type GithubContentItem = {
    type: "file" | "dir";
    name: string;
    path: string;
};

// Server Configuration
const HOST = process.env.HOST;

if (!HOST) {
    console.error("❌ HOST environment variable is not set. Exiting.");
    process.exit(1);
}

const PORT = parseInt(process.env.PORT || "0");

if (isNaN(PORT) || PORT <= 0 || PORT > 65535) {
    console.error("❌ PORT environment variable is not set or invalid. Exiting.");
    process.exit(1);
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const chatbot_PATH = path.join(__dirname, "chatbot_users.gcm.json")
const CHATBOT_API_KEY = process.env.CHATBOT_API_KEY

if (!CHATBOT_API_KEY) {
    console.error("❌ CHATBOT_API_KEY not set")
    process.exit(1)
}

type SseClient = {
    res: Response;
    hasKey: boolean;
};

const clients: SseClient[] = [];

async function updateUsersFile(
    mutate: (doc: any) => void,
    retries = 5
): Promise<void> {
    for (let i = 0; i < retries; i++) {
        let doc: any

        try {
            const raw = await fs.promises.readFile(chatbot_PATH, "utf8")

            if (!raw.trim()) {
                throw new Error("Empty users file")
            }

            doc = JSON.parse(raw)
        } catch {
            console.warn("Users file missing, empty, or invalid, initialising new store")

            doc = {
                version: 0,
                updatedAt: new Date().toISOString(),
                users: []
            }
        }

        const baseVersion =
            typeof doc.version === "number" ? doc.version : 0

        mutate(doc)

        doc.version = baseVersion + 1
        doc.updatedAt = new Date().toISOString()

        const tmp = `${chatbot_PATH}.${process.pid}.${Date.now()}.tmp`

        await fs.promises.writeFile(
            tmp,
            JSON.stringify(doc, null, 2),
            "utf8"
        )

        try {
            await fs.promises.rename(tmp, chatbot_PATH)
            return
        } catch {
            await fs.promises.unlink(tmp).catch(() => { })
        }
    }

    throw new Error("Failed to commit user file after multiple retries")
}

function registerPage(error = "", apiKey = "") {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Register User</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
        <style>
        body {
          background: #0f172a;
          color: #e5e7eb;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .card {
          background: #020617;
          padding: 2rem;
          border-radius: 12px;
          width: 100%;
          max-width: 360px;
          box-shadow: 0 0 40px rgba(0,0,0,.7);
        }
        .card input,
        .card button {
          box-sizing: border-box;
        }
        h1 {
          text-align: center;
          margin-bottom: 1rem;
        }
        input {
          width: 100%;
          padding: 14px;
          margin-top: 10px;
          border-radius: 6px;
          border: none;
          background: #020617;
          color: white;
          font-size: 16px;
        }
        button {
          width: 100%;
          margin-top: 20px;
          padding: 14px;
          background: #16a34a;
          border: none;
          border-radius: 6px;
          color: white;
          font-weight: bold;
          font-size: 16px;
        }
        .error {
          color: #f87171;
          text-align: center;
          margin-top: 12px;
        }
        </style>
      </head>
      <body>
        <form class="card" method="POST">
          <!-- Hidden relay field -->
          <input type="hidden" name="apiKey" value="${apiKey}">
  
          <h1>Register</h1>
          <input name="username" placeholder="Username" required />
          <input name="password" type="password" placeholder="Password" required />
          <button type="submit">Create User</button>
  
          <div style="margin-top: 10px; font-size: 13px; color: #94a3b8;">
            API key seen by server:
            <code style="display: block; margin-top: 6px; padding: 8px; background: #0f172a; border-radius: 6px; word-break: break-all;">
              ${apiKey || "(empty)"}
            </code>
          </div>
  
          ${error ? `<div class="error">${error}</div>` : ""}
        </form>
      </body>
      </html>
    `;
}

async function getChapters(storyPath: string): Promise<{ chapters: number[], urls: string[] }> {
    const chapters: number[] = [];
    const urls: string[] = [];
    const BASE = "https://kittycrypto.gg";

    const remotePath = storyPath.replace(/^\.\//, "");
    try {
        const url0 = `${BASE}/${remotePath}/chapt0.xml`;
        const res0 = await fetch(url0, { method: "HEAD" });
        if (res0.ok) {
            chapters.push(0);
            urls.push(url0);
        }
    } catch { /* No chapter 0; do nothing */ }

    let i = 1;
    while (true) {
        const url = `${BASE}/${remotePath}/chapt${i}.xml`;
        try {
            const res = await fetch(url, { method: "HEAD" });
            if (!res.ok) break;
            chapters.push(i);
            urls.push(url);
            i++;
        } catch {
            console.log(`Discovered ${chapters.length} chapters for ${storyPath}.`);
            break;
        }
    }

    console.log(`Discovered ${chapters.length} chapters for ${storyPath}.`);
    return { chapters, urls };
}

// Helper: Get all HTML files at repo root (and subdirs if needed)
async function getHtmlPagesFromGithub(repoOwner: string, repoName: string, dir: string = ""): Promise<string[]> {
    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${dir}`;

    const headers: Record<string, string> = { "User-Agent": "kitty-sitemap-bot" };

    if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;

    const res = await fetch(apiUrl, { headers });

    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    const items = await res.json() as GithubContentItem[];
    let urls: string[] = [];
    for (const item of items) {
        if (item.type === "file" && item.name.endsWith(".html")) {
            const pagePath = dir ? `${dir}/${item.name}` : item.name;
            urls.push(`https://kittycrypto.gg/${pagePath.replace(/^index\.html$/, "")}`); // root index.html = /
        } else if (item.type === "dir") {
            urls.push(...await getHtmlPagesFromGithub(repoOwner, repoName, item.path));
        }
    }
    return urls;
}

// Chat JSON File Path
//const chat_json_path = path.join(__dirname, "chat.json");
const chat_json_path = path.join(__dirname, "chat.gcm.json");
// console.log(`Chat JSON File Path: ${chat_json_path}`);

// Comments JSON File Path
const comments_json_path = path.join(__dirname, "comments.json");
// console.log(`Comments JSON File Path: ${comments_json_path}`);

const allowedOrigins = [
    "https://kittycrypto.gg",
    "https://render.kittycrypto.gg",
    "https://test.kittycrypto.gg",
    "https://api.kittycrypto.gg",
    "https://app.kittycrypto.gg",
    "https://chat.kittycrypto.gg",
    "https://srv.kittycrypto.gg",
    "http://localhost:8000",
];

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

const requestHandler = new KittyRequest(server, "null", TokenStore, (_data): _data is {} => true);

// // Store SSE clients
// const clients: Response[] = [];

// Generate a secure session token
function generateSessionToken(): string {
    return crypto.randomBytes(64).toString("hex");
}

// Endpoint to request a session token
server.app.get("/session-token", async (req: Request, res: Response) => {

    try {
        await TokenStore.waitUntilReady();
    } catch {
        res.status(503).json({ error: "Server initialising. Try again." });
        return;
    }

    const sessionToken = generateSessionToken();
    TokenStore.touchToken(sessionToken);
    res.json({ sessionToken });
});

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

// Helper function to extract and normalise IP
function getClientIp(req: Request): string {
    const cf = req.headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf.trim()) return cf.trim();

    const xff = req.headers["x-forwarded-for"];
    const raw = Array.isArray(xff) ? xff[0] : xff;

    let ip = typeof raw === "string" && raw.trim()
        ? raw.split(",")[0]!.trim()
        : (req.socket.remoteAddress || "");

    if (ip.startsWith("::ffff:")) ip = ip.substring(7);
    return ip;
}

// Endpoint: Get Raw IP
server.app.get("/get-ip", cors({ origin: "*" }), (req: Request, res: Response) => {
    res.json({ ip: getClientIp(req) });
});

// Endpoint: Get Hashed IP
server.app.get("/get-ip/sha256", cors({ origin: "*" }), (req: Request, res: Response) => {
    try {
        const hashedId = chat.generateUserId(getClientIp(req));
        res.json({ hashedIp: hashedId });
    } catch (error) {
        console.error("❌ Error hashing IP:", error);
        res.status(500).json({ error: "Failed to hash IP address." });
    }
});

function originAllowsDecrypted(origin: string | undefined): boolean {
    if (!origin) return false;      // your rule: no Origin => encrypted
    if (origin === "null") return false;
    return server.allowedOriginsList.includes(origin);
}

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
    const wantsDecrypted = originAllowsDecrypted(origin);

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

// Notify SSE Clients When New Chat Messages Arrive
function notifyClients() {
    const decrypted = chat.loadAndDecryptChat();
    const encrypted = chat.loadEncryptedChat();

    for (const c of clients) {
        const payload = c.hasKey ? decrypted : encrypted;
        c.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
}

// asynchronously track changes in chat.json every 1 second and update clients if changes are detected (use fs.promises from fs)
async function trackChatChanges() {
    let lastChatData = await fs.promises.readFile(chat_json_path, "utf-8");
    console.log(`📔 Tracking chat changes in ${chat_json_path}`);
    setInterval(async () => {
        const newChatData = await fs.promises.readFile(chat_json_path, "utf-8");
        if (newChatData !== lastChatData) {
            chat.clearMessageCache();
            lastChatData = newChatData;
            console.log("🔄 Chat data updated. Notifying clients...");
            notifyClients();
        }
    }, 1000);
}

// Modify Chat to Call `notifyClients()` When New Messages Arrive
chat.onNewMessage = notifyClients;

const blogger = new GithubAutoScheduler({
    owner: "KittyCrypto-gg",
    repos: ["server", "website"],
    blogUser: "autoKitty"
});

server.app.get('/robots.txt', (req, res) => { // Serve robots.txt
    res.type('text/plain');
    res.send(
        `User-agent: *
            Disallow:
            Sitemap: https://render.kittycrypto.gg/sitemap.xml
            Host: render.kittycrypto.gg`
    );
});

const storiesRoot = path.resolve(__dirname, "stories");

type StoriesIndex = Record<string, string[]>;

async function exploreStories(): Promise<StoriesIndex> {

    const out: StoriesIndex = {};

    const isStoryDirName = (name: string): boolean => {
        return /^[a-zA-Z0-9 _-]+$/.test(name);
    }

    const isChapterXml = (name: string): boolean => {
        return /^chapt\d+\.xml$/i.test(name);
    }

    const entries = await fs.promises.readdir(storiesRoot, { withFileTypes: true });
    const storyDirs = entries.filter((e) => e.isDirectory() && isStoryDirName(e.name));

    for (const dir of storyDirs) {
        const storyPath = path.join(storiesRoot, dir.name);
        const files = await fs.promises.readdir(storyPath, { withFileTypes: true });

        const chapters = files
            .filter((f) => f.isFile() && isChapterXml(f.name))
            .map((f) => f.name)
            .sort((a, b) => {
                const na = Number((a.match(/^chapt(\d+)\.xml$/i) ?? ["", "0"])[1]);
                const nb = Number((b.match(/^chapt(\d+)\.xml$/i) ?? ["", "0"])[1]);
                return na - nb;
            });

        out[dir.name] = chapters;
    }

    return out;
}

async function resolveStoryPath(rest: string): Promise<string | null> {

    let cleaned: string;
    try {
        cleaned = decodeURIComponent(rest);
    } catch {
        return null;
    }

    cleaned = cleaned
        .replace(/^\/+/, "")
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/");

    if (!cleaned) return null;

    const segments = cleaned.split("/");

    for (const seg of segments) {
        if (!seg) return null;
        if (seg === "." || seg === "..") return null;
        if (!/^[a-zA-Z0-9._ + -]+$/.test(seg)) return null;
    }

    const filePath = path.resolve(storiesRoot, ...segments);

    const rel = path.relative(storiesRoot, filePath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;

    try {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile()) return null;

        await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
        return null;
    }

    return filePath;
}

server.app.get("/stories.json", async (_req: Request, res: Response) => {
    try {
        const index = await exploreStories();
        res.json(index);
    } catch {
        res.status(500).json({ error: "Failed to generate stories index." });
    }
});

server.app.get(/^\/stories\/(.+)$/, async (req: Request, res: Response) => {
    const rest = req.params[0] ?? "";
    const filePath = await resolveStoryPath(rest);

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
    try {
        const githubPages = await getHtmlPagesFromGithub("kittyCrypto-gg", "website");

        const storiesRes = await fetch("https://kittycrypto.gg/scripts/stories.json");
        const stories = await storiesRes.json() as Record<string, string>;

        const storyChapterLinks: string[] = [];
        for (const [storyName, storyPath] of Object.entries(stories)) {
            const { chapters } = await getChapters(storyPath);
            console.log(`Story: ${storyName}, Path: ${storyPath}, Chapters:`, chapters);
            for (const chapter of chapters) {
                const url = `https://render.kittycrypto.gg/reader.html?story=${encodeURIComponent(storyPath)}&chapter=${chapter}`;
                console.log("Adding URL:", url);
                storyChapterLinks.push(url);
            }
        }

        const allUrls = [...githubPages, ...storyChapterLinks]
            .map(url => url.replace(/\/+$/, ""))
            .filter((v, i, arr) => arr.indexOf(v) === i);

        // XML ESCAPE function
        function xmlEscape(str: string) {
            return str.replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&apos;");
        }

        // Build XML sitemap (no extra indentation, valid xml)
        const locs = allUrls.map(
            url => `<url><loc>${xmlEscape(url)}</loc></url>`
        ).join("\n");

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
            `${locs}\n` +
            `</urlset>`;

        res.set("Content-Type", "application/xml");
        res.send(xml);
        console.log(`✅ Sitemap generated with ${allUrls.length} URLs.`);
    } catch (error) {
        console.error("❌ Error generating sitemap:", error);
        res.status(500).send("Failed to generate sitemap.");
    }
});

const allowedSourcesPath = path.join(__dirname, "data", "allowedSources.json");

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
        res.type("text/html").send(registerPage("", apiKey));
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
            res.type("text/html").send(registerPage("Missing fields", apiKey));
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

        await updateUsersFile(doc => {
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
            registerPage("Registration failed", apiKey)
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

const renderer = new Renderer(server);

server.start();
trackChatChanges();

//server.logEndpoints();

console.log(chat.readyMessage());
console.log(comment.readyMessage());
console.log(renderer.readyMessage());

console.log(`🚀 Kitty Server is running on https://${HOST}:${PORT}`);

//blogger.runOnceNow();
