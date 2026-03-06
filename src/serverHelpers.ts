import path from "path";
import fs from "fs";
import { Request, Response } from "express";
import * as ImageTransformer from "./imageTransformer";
import fetch from "node-fetch"
import * as types from "./types"
import crypto from "crypto";
import Server from "./baseServer";
import Chat from "./kittyChat";

export function parseImgQuery(req: Request): types.ImgQueryParseResult {
    const src = readTrimmedQueryString(req, "src");
    if (!src) {
        return { ok: false, httpStatus: 400, message: "Missing mandatory query param: src" };
    }

    const formatRaw = readTrimmedQueryString(req, "format");
    const format = normaliseImgFormat(formatRaw);
    if (formatRaw && !format) {
        return { ok: false, httpStatus: 400, message: "Invalid format. Use png|jpg|jpeg|gif|bmp|svg|tif|tiff" };
    }

    const srcFormatHintRaw = readTrimmedQueryString(req, "srcFormatHint") || readTrimmedQueryString(req, "srcFormat");
    const srcFormatHint = normaliseImgFormat(srcFormatHintRaw);
    if (srcFormatHintRaw && !srcFormatHint) {
        return {
            ok: false,
            httpStatus: 400,
            message: "Invalid srcFormat/srcFormatHint. Use png|jpg|jpeg|gif|bmp|svg|tif|tiff",
        };
    }

    const width = parsePositiveInt(readTrimmedQueryString(req, "width"));
    const height = parsePositiveInt(readTrimmedQueryString(req, "height"));

    return {
        ok: true,
        src,
        format,
        srcFormatHint,
        resize: { width: width ?? undefined, height: height ?? undefined },
    };
}

export function readTrimmedQueryString(req: Request, key: string): string {
    const raw = req.query[key];
    if (typeof raw !== "string") return "";
    return raw.trim();
}

export function normaliseImgFormat(value: string): ImageTransformer.SupportedFormat | null {
    if (!value) return null;

    switch (value.toLowerCase()) {
        case "jpeg":
            return "jpeg";
        case "jpg":
            return "jpg";
        case "png":
            return "png";
        case "gif":
            return "gif";
        case "bmp":
            return "bmp";
        case "svg":
            return "svg";
        case "tif":
            return "tif";
        case "tiff":
            return "tiff";
        default:
            return null;
    }
}

export function parsePositiveInt(value: string): number | null {
    if (!value) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const i = Math.floor(n);
    return i > 0 ? i : null;
}

export function buildRequestBaseUrl(req: Request): string | undefined {
    const host = typeof req.headers.host === "string" ? req.headers.host : "";
    if (!host) return undefined;

    const proto = typeof req.protocol === "string" ? req.protocol : "https";
    return `${proto}://${host}${req.originalUrl}`;
}

export function sendImgResult(res: Response, result: types.ImgResultShape): void {
    res.status(200);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(Buffer.from(result.body));
}

export function sendImgError(res: Response, err: unknown): void {
    if (err instanceof ImageTransformer.ImageTransformError) {
        res.status(err.httpStatus).send(err.message);
        return;
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).send(message);
}

export async function updateUsersFile(
    mutate: (doc: any) => void,
    retries = 5
): Promise<void> {
    for (let i = 0; i < retries; i++) {
        let doc: any

        try {
            const raw = await fs.promises.readFile(process.env.CHATBOT_PATH || "", "utf8");

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

        const tmp = `${process.env.CHATBOT_PATH}.${process.pid}.${Date.now()}.tmp`;

        await fs.promises.writeFile(
            tmp,
            JSON.stringify(doc, null, 2),
            "utf8"
        )

        try {
            await fs.promises.rename(tmp, process.env.CHATBOT_PATH || "")
            return
        } catch {
            await fs.promises.unlink(tmp).catch(() => { })
        }
    }

    throw new Error("Failed to commit user file after multiple retries")
}

export function registerPage(error = "", apiKey = "") {
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

export async function getChapters(storyPath: string): Promise<{ chapters: number[], urls: string[] }> {
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

export async function getHtmlPagesFromGithub(repoOwner: string, repoName: string, dir: string = ""): Promise<string[]> {
    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${dir}`;

    const headers: Record<string, string> = { "User-Agent": "kitty-sitemap-bot" };

    if (process.env.GITHUB_TOKEN) headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;

    const res = await fetch(apiUrl, { headers });

    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    const items = await res.json() as types.GithubContentItem[];
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

export function generateSessionToken(): string {
    return crypto.randomBytes(64).toString("hex");
}

export function getClientIp(req: Request): string {
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

export function originAllowsDecrypted(origin: string | undefined, server: Server): boolean {
    if (!origin) return false;      // your rule: no Origin => encrypted
    if (origin === "null") return false;
    return server.allowedOriginsList.includes(origin);
}

export function notifyClients(chat: Chat, clients: types.SseClient[]) {
    const decrypted = chat.loadAndDecryptChat();
    const encrypted = chat.loadEncryptedChat();

    for (const c of clients) {
        const payload = c.hasKey ? decrypted : encrypted;
        c.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
}

export async function trackChatChanges(chat_json_path: string, chat: Chat, clients: types.SseClient[]) {
    let lastChatData = await fs.promises.readFile(chat_json_path, "utf-8");
    console.log(`📔 Tracking chat changes in ${chat_json_path}`);
    setInterval(async () => {
        const newChatData = await fs.promises.readFile(chat_json_path, "utf-8");
        if (newChatData !== lastChatData) {
            chat.clearMessageCache();
            lastChatData = newChatData;
            console.log("🔄 Chat data updated. Notifying clients...");
            notifyClients(chat, clients);
        }
    }, 1000);
}

export async function resolveStoryPath(rest: string, storiesRoot: string): Promise<string | null> {

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

export async function exploreStories(storiesRoot: string): Promise<types.StoriesIndex> {

    const out: types.StoriesIndex = {};

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

export async function genSiteMap(
    includedPages: ReadonlySet<string> = new Set<string>(),
    res: Response
): Promise<void> {
    try {
        const githubPages = await getHtmlPagesFromGithub("kittyCrypto-gg", "website");

        const shouldFilterGitHubPages = includedPages.size > 0;

        const filteredGithubPages = shouldFilterGitHubPages
            ? githubPages.filter((pageUrl) => {
                const pageUrlObject = new URL(pageUrl);
                const relativePath = decodeURIComponent(pageUrlObject.pathname.replace(/^\/+/, ""));
                const fileName = relativePath.split("/").pop() ?? "";

                return includedPages.has(relativePath) || includedPages.has(fileName);
            })
            : githubPages;

        const storiesRes = await fetch("https://srv.kittycrypto.gg/stories.json");
        const stories = await storiesRes.json() as Record<string, string[]>;

        const storyChapterLinks = Object.entries(stories).flatMap(([storyPath, chapters]) =>
            chapters.map((chapter) =>
                `https://nojs.kittycrypto.gg/reader.html?story=${encodeURIComponent(storyPath)}&chapter=${encodeURIComponent(chapter)}`
            )
        );

        const allUrls = [...filteredGithubPages, ...storyChapterLinks]
            .map((url) => url.replace(/\/+$/, ""))
            .filter((value, index, entries) => entries.indexOf(value) === index);

        function xmlEscape(value: string): string {
            return value
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&apos;");
        }

        const locs = allUrls
            .map((url) => `<url><loc>${xmlEscape(url)}</loc></url>`)
            .join("\n");

        const xml =
            `<?xml version="1.0" encoding="UTF-8"?>\n` +
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
}