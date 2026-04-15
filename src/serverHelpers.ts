import * as ImageTransformer from "./imageTransformer";
import { execSync } from "node:child_process";
import { Request, Response } from "express";
import { tokenStore } from "./tokenStore";
import Server from "./baseServer";
import * as types from "./types";
import Chat from "./kittyChat";
import fetch from "node-fetch";
import crypto from "crypto";
import path from "path";
import fs from "fs";
/* @ts-ignore */
import "dotenv/config";

interface SshdProcessInfo {
    processUser: string;
    pid: number;
    kind: "listener" | "privileged-monitor" | "session" | "unknown";
    sessionUser: string | null;
    terminal: string | null;
    rawCommand: string;
}

interface PresenceConfigFile {
    http?: {
        host?: unknown;
        port?: unknown;
    };
}

interface InternalPresenceSnapshot {
    userId: string;
    status: string;
    isAfk: boolean;
    activity: string;
    lastSshSeenAt: number | null;
    lastActivityAt: number | null;
    updatedAt: number;
}

interface PublicPresenceSnapshot {
    status: string;
    isAfk: boolean;
    activity: string;
    lastSshSeenAt: string | null;
    lastActivityAt: string | null;
    updatedAt: string | null;
}

type ChatbotUser = {
    username: string;
    hash: string;
};

type ChatbotDoc = {
    version: number;
    updatedAt: string;
    users: ChatbotUser[];
};

type NodeErrorWithCode = Error & { code?: string };

export interface OpenChatStreamOptions {
    req: Request;
    res: Response;
    token: string;
    tokenStore: tokenStore;
    chat: Chat;
    clients: types.SseClient[];
    hasKey: boolean;
    heartbeatMS?: number;
    retryMS?: number;
}

type NtcFile = unknown[] | Record<string, unknown>;

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
            message: "Invalid srcFormat/srcFormatHint. Use png|jpg|jpeg|gif|bmp|svg|tif|tiff"
        };
    }

    const width = parsePositiveInt(readTrimmedQueryString(req, "width"));
    const height = parsePositiveInt(readTrimmedQueryString(req, "height"));

    return {
        ok: true,
        src,
        format,
        srcFormatHint,
        resize: { width: width ?? undefined, height: height ?? undefined }
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

function createInitialChatbotDoc(): ChatbotDoc {
    return {
        version: 0,
        updatedAt: new Date().toISOString(),
        users: []
    };
}

function normaliseChatbotDoc(value: unknown): ChatbotDoc {
    if (typeof value !== "object" || value === null) {
        return createInitialChatbotDoc();
    }

    const raw = value as Partial<ChatbotDoc>;
    const users = Array.isArray(raw.users)
        ? raw.users.filter((entry: unknown): entry is ChatbotUser => {
            return (
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as ChatbotUser).username === "string" &&
                typeof (entry as ChatbotUser).hash === "string"
            );
        })
        : [];

    return {
        version: typeof raw.version === "number" ? raw.version : 0,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
        users
    };
}

export async function updateUsersFile(
    mutate: (doc: ChatbotDoc) => void,
    retries = 5
): Promise<void> {
    const targetPath = process.env.CHATBOT_PATH || "";

    if (!targetPath) {
        throw new Error("CHATBOT_PATH is not configured");
    }

    for (let i = 0; i < retries; i++) {
        let doc: ChatbotDoc;

        try {
            const raw = await fs.promises.readFile(targetPath, "utf8");

            if (!raw.trim()) {
                throw new Error("Empty users file");
            }

            doc = normaliseChatbotDoc(JSON.parse(raw) as unknown);
        } catch {
            console.warn("Users file missing, empty, or invalid, initialising new store");
            doc = createInitialChatbotDoc();
        }

        const baseVersion = doc.version;

        mutate(doc);

        doc.version = baseVersion + 1;
        doc.updatedAt = new Date().toISOString();

        const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

        await fs.promises.writeFile(
            tmp,
            JSON.stringify(doc, null, 2),
            "utf8"
        );

        try {
            await fs.promises.rename(tmp, targetPath);
            return;
        } catch {
            await fs.promises.unlink(tmp).catch(() => { });
        }
    }

    throw new Error("Failed to commit user file after multiple retries");
}

export function registerPage(error = "", apiKey = ""): string {
    const registerTemplate = fs.readFileSync(
        path.resolve(__dirname, "../ui/register.html"),
        "utf-8"
    );

    const escapeHtml = (value: string): string => {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\"", "&quot;")
            .replaceAll("'", "&#39;");
    };

    const safeApiKey = escapeHtml(apiKey);
    const safeError = escapeHtml(error);

    return registerTemplate
        .replace("{{API_KEY_ATTR}}", safeApiKey)
        .replace("{{API_KEY_DISPLAY}}", safeApiKey || "(empty)")
        .replace(
            "{{ERROR_BLOCK}}",
            safeError ? `<div class="error">${safeError}</div>` : ""
        );
}

export async function getChapters(storyPath: string): Promise<{ chapters: number[]; urls: string[] }> {
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
    } catch { }

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

    if (process.env.GITHUB_TOKEN) {
        headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(apiUrl, { headers });

    if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const items = await res.json() as types.GithubContentItem[];
    let urls: string[] = [];

    for (const item of items) {
        if (item.type === "file" && item.name.endsWith(".html")) {
            const pagePath = dir ? `${dir}/${item.name}` : item.name;
            urls.push(`https://kittycrypto.gg/${pagePath.replace(/^index\.html$/, "")}`);
            continue;
        }

        if (item.type === "dir") {
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

    if (ip.startsWith("::ffff:")) {
        ip = ip.substring(7);
    }

    return ip;
}

export function originAllowsDecrypted(origin: string | undefined, server: Server): boolean {
    if (!origin) return false;
    if (origin === "null") return false;
    return server.allowedOriginsList.includes(origin);
}

export function isSseResponseWritable(res: Response): boolean {
    if (res.writableEnded) return false;
    if (res.destroyed) return false;
    if (res.socket?.destroyed) return false;
    return true;
}

export function writeSseJson(res: Response, payload: unknown): void {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function writeSseComment(res: Response, comment: string): void {
    res.write(`: ${comment}\n\n`);
}

export function removeSseClient(clients: types.SseClient[], res: Response): void {
    const index = clients.findIndex((client) => client.res === res);

    if (index !== -1) {
        clients.splice(index, 1);
    }
}

export async function openChatStream(options: OpenChatStreamOptions): Promise<void> {
    const {
        req,
        res,
        token,
        tokenStore,
        chat,
        clients,
        hasKey,
        heartbeatMS = 15_000,
        retryMS = 5_000
    } = options;

    tokenStore.touchToken(token);
    req.socket.setKeepAlive(true, heartbeatMS);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(`retry: ${retryMS}\n\n`);
    writeSseComment(res, "connected");

    const initialPayload = hasKey
        ? await chat.loadAndDecryptChat()
        : await chat.loadEncryptedChat();

    writeSseJson(res, initialPayload);

    clients.push({ res, hasKey });

    const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
        if (!isSseResponseWritable(res) || req.destroyed) {
            return;
        }

        tokenStore.touchToken(token);
        writeSseComment(res, `keepalive ${Date.now()}`);
    }, heartbeatMS);

    const cleanup = (): void => {
        clearInterval(heartbeat);
        removeSseClient(clients, res);
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("close", cleanup);
    res.on("finish", cleanup);
}

export async function notifyClients(chat: Chat, clients: types.SseClient[]): Promise<void> {
    const [decrypted, encrypted] = await Promise.all([
        chat.loadAndDecryptChat(),
        chat.loadEncryptedChat()
    ]);

    const staleResponses: Response[] = [];

    for (const client of clients) {
        if (!isSseResponseWritable(client.res)) {
            staleResponses.push(client.res);
            continue;
        }

        const payload = client.hasKey ? decrypted : encrypted;

        try {
            writeSseJson(client.res, payload);
        } catch {
            staleResponses.push(client.res);
        }
    }

    for (const res of staleResponses) {
        removeSseClient(clients, res);
    }
}

async function readFileOrEmpty(filePath: string): Promise<string> {
    try {
        return await fs.promises.readFile(filePath, "utf-8");
    } catch (error: unknown) {
        const code = (error as NodeErrorWithCode).code;

        if (code === "ENOENT") {
            return "";
        }

        throw error;
    }
}

export async function trackChatChanges(chat_json_path: string, chat: Chat, clients: types.SseClient[]): Promise<void> {
    let lastChatData = await readFileOrEmpty(chat_json_path);
    let busy = false;

    console.log(`📔 Tracking chat changes in ${chat_json_path}`);

    setInterval(() => {
        if (busy) {
            return;
        }

        busy = true;

        void (async () => {
            try {
                const newChatData = await readFileOrEmpty(chat_json_path);

                if (newChatData !== lastChatData) {
                    chat.clearMessageCache();
                    lastChatData = newChatData;
                    console.log("🔄 Chat data updated. Notifying clients...");
                    await notifyClients(chat, clients);
                }
            } catch (error) {
                console.error("❌ Error tracking chat changes:", error);
            } finally {
                busy = false;
            }
        })();
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

    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        return null;
    }

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
    };

    const isChapterXml = (name: string): boolean => {
        return /^chapt\d+\.xml$/i.test(name);
    };

    const entries = await fs.promises.readdir(storiesRoot, { withFileTypes: true });
    const storyDirs = entries.filter((entry) => entry.isDirectory() && isStoryDirName(entry.name));

    for (const dir of storyDirs) {
        const storyPath = path.join(storiesRoot, dir.name);
        const files = await fs.promises.readdir(storyPath, { withFileTypes: true });

        const chapters = files
            .filter((file) => file.isFile() && isChapterXml(file.name))
            .map((file) => file.name)
            .sort((a, b) => {
                const aMatch = a.match(/^chapt(\d+)\.xml$/i);
                const bMatch = b.match(/^chapt(\d+)\.xml$/i);

                const na = Number(aMatch?.[1] ?? "0");
                const nb = Number(bMatch?.[1] ?? "0");

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

        const storyChapterLinks = Object.entries(stories).flatMap(([storyPath, chapters]) => {
            return chapters.map((chapter) => {
                return `https://nojs.kittycrypto.gg/reader.html?story=${encodeURIComponent(storyPath)}&chapter=${encodeURIComponent(chapter)}`;
            });
        });

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

export const readVisitSource = (req: Request): string => {
    const bodySource = typeof req.body?.source === "string" ? req.body.source : "";

    if (bodySource.trim()) {
        return bodySource;
    }

    const querySource = typeof req.query.source === "string" ? req.query.source : "";

    if (querySource.trim()) {
        return querySource;
    }

    return typeof req.headers.referer === "string" ? req.headers.referer : "";
};

function isInternalPresenceSnapshot(value: unknown): value is InternalPresenceSnapshot {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const snapshot = value as Record<string, unknown>;

    return (
        typeof snapshot.userId === "string" &&
        typeof snapshot.status === "string" &&
        typeof snapshot.isAfk === "boolean" &&
        typeof snapshot.activity === "string" &&
        (typeof snapshot.lastSshSeenAt === "number" || snapshot.lastSshSeenAt === null) &&
        (typeof snapshot.lastActivityAt === "number" || snapshot.lastActivityAt === null) &&
        typeof snapshot.updatedAt === "number"
    );
}

function formatPresenceDate(timestamp: number | null): string | null {
    if (timestamp === null) {
        return null;
    }

    const date = new Date(timestamp);
    const pad = (value: number): string => String(value).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function getPresenceBaseUrl(): Promise<string> {
    const configPath = process.env.PRESENCE_CONFIG_PATH;

    if (typeof configPath !== "string" || configPath.trim().length === 0) {
        throw new Error("PRESENCE_CONFIG_PATH is not set.");
    }

    const rawConfig = await fs.promises.readFile(configPath, "utf8");
    const parsedConfig = JSON.parse(rawConfig) as PresenceConfigFile;

    const host = parsedConfig.http?.host;
    const port = parsedConfig.http?.port;

    if (typeof host !== "string" || host.trim().length === 0) {
        throw new Error("Presence config http.host is missing or invalid.");
    }

    if (typeof port !== "number" || Number.isInteger(port) === false || port < 1 || port > 65535) {
        throw new Error("Presence config http.port is missing or invalid.");
    }

    return `http://${host}:${port}`;
}

export async function getInternalPresence(): Promise<InternalPresenceSnapshot[]> {
    const baseUrl = await getPresenceBaseUrl();
    const response = await fetch(`${baseUrl}/internal/presence`);

    if (!response.ok) {
        throw new Error(`Presence backend returned ${response.status}.`);
    }

    const payload = await response.json() as unknown;

    if (Array.isArray(payload) === false) {
        throw new Error("Presence backend did not return an array.");
    }

    return payload.filter((entry): entry is InternalPresenceSnapshot => {
        return isInternalPresenceSnapshot(entry);
    });
}

export async function getPublicPresence(): Promise<PublicPresenceSnapshot> {
    const internalPresence = await getInternalPresence();

    const kitty = internalPresence.find((entry) => entry.userId === "kitty");

    if (!kitty) {
        throw new Error("Presence entry for \"kitty\" was not found.");
    }

    kitty.status = kitty.status.toLowerCase() === "terminal" ? "Online" : kitty.status;

    return {
        status: kitty.status,
        isAfk: kitty.isAfk,
        activity: kitty.activity,
        lastSshSeenAt: formatPresenceDate(kitty.lastSshSeenAt),
        lastActivityAt: formatPresenceDate(kitty.lastActivityAt),
        updatedAt: formatPresenceDate(kitty.updatedAt)
    };
}

export function psGrepSSHD(): SshdProcessInfo[] {
    try {
        const result = execSync("ps -eo user=,pid=,args=", {
            encoding: "utf-8"
        });

        return result
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.includes("sshd:"))
            .map((line) => parseSshdProcessLine(line));
    } catch (error: unknown) {
        const code = (error as NodeErrorWithCode).code;

        if (code === "ENOENT") {
            throw new Error("ps command not found");
        }

        throw error;
    }
}

function parseSshdProcessLine(line: string): SshdProcessInfo {
    const baseMatch = line.match(/^(\S+)\s+(\d+)\s+(.+)$/);

    if (baseMatch === null) {
        return {
            processUser: "unknown",
            pid: -1,
            kind: "unknown",
            sessionUser: null,
            terminal: null,
            rawCommand: line
        };
    }

    const [, processUser, pidRaw, rawCommand] = baseMatch;
    const pid = Number.parseInt(pidRaw, 10);

    const sessionMatch = rawCommand.match(/^sshd:\s+([^@\s]+)@(\S+)\s*$/);

    if (sessionMatch !== null) {
        const [, sessionUser, terminal] = sessionMatch;

        return {
            processUser,
            pid,
            kind: "session",
            sessionUser,
            terminal,
            rawCommand
        };
    }

    const privilegedMonitorMatch = rawCommand.match(/^sshd:\s+(\S+)\s+\[priv\]\s*$/);

    if (privilegedMonitorMatch !== null) {
        const [, sessionUser] = privilegedMonitorMatch;

        return {
            processUser,
            pid,
            kind: "privileged-monitor",
            sessionUser,
            terminal: null,
            rawCommand
        };
    }

    if (rawCommand.startsWith("sshd: /usr/sbin/sshd")) {
        return {
            processUser,
            pid,
            kind: "listener",
            sessionUser: null,
            terminal: null,
            rawCommand
        };
    }

    return {
        processUser,
        pid,
        kind: "unknown",
        sessionUser: null,
        terminal: null,
        rawCommand
    };
}

export interface BuildManifest {
    version: 1;
    files: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
    if (!isRecord(value)) {
        return false;
    }

    return Object.values(value).every((entry) => typeof entry === "string");
}

export function isBuildManifest(value: unknown): value is BuildManifest {
    if (!isRecord(value)) {
        return false;
    }

    if (value.version !== 1) {
        return false;
    }

    return isStringRecord(value.files);
}

export function normalisManifest(value: unknown): BuildManifest | null {
    if (!isBuildManifest(value)) {
        return null;
    }

    return {
        version: 1,
        files: { ...value.files }
    };
}

export function getBuildManifestPath(): string {
    const configuredPath = typeof process.env.BUILD_MANIFEST_PATH === "string"
        ? process.env.BUILD_MANIFEST_PATH.trim()
        : "";

    if (configuredPath) {
        return configuredPath;
    }

    return path.resolve(process.cwd(), "data", "buildManifest.json");
}

export function readBuildKeyHeader(req: Request): string {
    const rawHeader = req.headers["x-build-key"];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    return typeof headerValue === "string" ? headerValue.trim() : "";
}

export function hasValidBuildKey(req: Request): boolean {
    const expectedKey = typeof process.env.BUILD_KEY === "string"
        ? process.env.BUILD_KEY.trim()
        : "";

    const receivedKey = readBuildKeyHeader(req);

    if (!expectedKey || !receivedKey) {
        return false;
    }

    const expectedBuffer = Buffer.from(expectedKey, "utf8");
    const receivedBuffer = Buffer.from(receivedKey, "utf8");

    if (expectedBuffer.length !== receivedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function readBuildManifest(): Promise<BuildManifest | null> {
    const targetPath = getBuildManifestPath();

    try {
        const raw = await fs.promises.readFile(targetPath, "utf8");

        if (!raw.trim()) {
            return null;
        }

        return normalisManifest(JSON.parse(raw) as unknown);
    } catch (error: unknown) {
        const code = (error as NodeErrorWithCode).code;

        if (code === "ENOENT") {
            return null;
        }

        throw error;
    }
}

export async function writeBuildManifest(manifest: BuildManifest): Promise<void> {
    const targetPath = getBuildManifestPath();
    const normalised = normalisManifest(manifest);

    if (normalised === null) {
        throw new Error("Cannot write invalid build manifest.");
    }

    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

    const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

    await fs.promises.writeFile(
        tmpPath,
        `${JSON.stringify(normalised, null, 2)}\n`,
        "utf8"
    );

    try {
        await fs.promises.rename(tmpPath, targetPath);
    } catch (error: unknown) {
        await fs.promises.unlink(tmpPath).catch(() => { });
        throw error;
    }
}

export async function updateManifest(value: unknown): Promise<BuildManifest> {
    const manifest = normalisManifest(value);

    if (manifest === null) {
        throw new Error("Invalid build manifest payload.");
    }

    await writeBuildManifest(manifest);
    return manifest;
}

function resDataPath(...segs: readonly string[]): string {
    const dataRoot = path.resolve(process.cwd(), "data");
    const filePath = path.resolve(dataRoot, ...segs);
    const rel = path.relative(dataRoot, filePath);

    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error("Unsafe data path.");
    }

    return filePath;
}

function getNtcsPath(): string {
    return resDataPath("notices.json");
}

export async function readNtcs(): Promise<NtcFile | null> {
    const targetPath = getNtcsPath();

    try {
        const raw = await fs.promises.readFile(targetPath, "utf8");

        if (!raw.trim()) {
            return null;
        }

        const parsed = JSON.parse(raw) as unknown;

        if (Array.isArray(parsed)) {
            return parsed;
        }

        if (isRecord(parsed)) {
            return parsed;
        }

        return null;
    } catch (error: unknown) {
        const code = (error as NodeErrorWithCode).code;

        if (code === "ENOENT") {
            return null;
        }

        throw error;
    }
}