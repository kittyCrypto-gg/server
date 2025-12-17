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

type SseClient = {
    res: Response;
    hasKey: boolean;
};

const clients: SseClient[] = [];

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
    const items = await res.json();
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

// Initialise the HTTPS server
const server = new Server(HOST, PORT);

server.app.use(
    cors({
        origin: (origin, callback) => {
            const allowedOrigins = [
                "https://kittycrypto.gg",
                "https://render.kittycrypto.gg",
                "https://hostel4pets.co.uk"
            ];
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        methods: ["GET", "POST", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    })
);

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
    return crypto.randomBytes(32).toString("hex");
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
    let ip = req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "";
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
        const stories: Record<string, string> = await storiesRes.json();

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

const renderer = new Renderer(server);

server.start();
trackChatChanges();

//server.logEndpoints();

console.log(chat.readyMessage());
console.log(comment.readyMessage());
console.log(renderer.readyMessage());

console.log(`🚀 Kitty Server is running on https://${HOST}:${PORT}`);

//blogger.runOnceNow();