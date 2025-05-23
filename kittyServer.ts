import path from "path";
import Server from "./baseServer";
import Chat from "./kittyChat";
import Comment from "./kittyComment";
import { CommentData } from "./kittyComment";
import cors from "cors";
import { promises } from "fs";
import crypto from "crypto";
import { Request, Response } from "express";
import KittyRequest from "./kittyRequest";
import { json } from "body-parser";

// Server Configuration
const HOST = "kittycrypto.ddns.net";
const PORT = 7619;

// Chat JSON File Path
const chat_json_path = path.join(__dirname, "chat.json");
console.log(`Chat JSON File Path: ${chat_json_path}`);

// Comments JSON File Path
const comments_json_path = path.join(__dirname, "comments.json");
console.log(`Comments JSON File Path: ${comments_json_path}`);

// Initialise the HTTPS server
const server = new Server(HOST, PORT);

server.app.use(
    cors({
        origin: "https://kittycrypto.gg",
        methods: ["GET", "POST", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    })
);

// Session store to track active sessions
const sessionTokens = new Set<string>();

const requestHandler = new KittyRequest(server, "none", sessionTokens, (data: unknown): data is object => true);
const chat = new Chat(server, chat_json_path, sessionTokens);
const comment = new Comment(server, sessionTokens);

// Store SSE clients
const clients: Response[] = [];

// Generate a secure session token
function generateSessionToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

// Endpoint to request a session token
server.app.get("/session-token", (req: Request, res: Response) => {
    const sessionToken = generateSessionToken();
    sessionTokens.add(sessionToken);
    res.json({ sessionToken });
    requestHandler.updateSessionTokens(sessionTokens);
});

// Helper function to extract and normalise IP
function getClientIp(req: Request): string {
    let ip = req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "";
    if (ip.startsWith("::ffff:")) ip = ip.substring(7);
    return ip;
}

// Endpoint: Get Raw IP
server.app.get("/get-ip", (req: Request, res: Response) => {
    res.json({ ip: getClientIp(req) });
});

// Endpoint: Get Hashed IP
server.app.get("/get-ip/sha256", (req: Request, res: Response) => {
    try {
        const hashedId = chat.generateUserId(getClientIp(req));
        res.json({ hashedIp: hashedId });
    } catch (error) {
        console.error("❌ Error hashing IP:", error);
        res.status(500).json({ error: "Failed to hash IP address." });
    }
});

// SSE Endpoint: Clients Subscribe to Chat Updates
server.app.get("/chat/stream", (req: Request, res: Response) => {
    const token = req.query.token as string;
    if (!token || !sessionTokens.has(token)) {
        res.setHeader("Content-Type", "application/json");
        res.json([{ nick: "system", id: "0x0000000000", msg: "Session expired. Refresh page to reconnect." }]);
        return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    console.log("🔗 New SSE connection established.");

    const fullChatHistory = JSON.stringify(chat.loadAndDecryptChat());

    res.write(`data: ${fullChatHistory}\n\n`);
    clients.push(res);

    req.on("close", () => {
        console.log("🔌 SSE client disconnected.");
        clients.splice(clients.indexOf(res), 1);
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

        const commentPath = comments_json_path;

        try {
            if (!await promises.stat(commentPath).then(() => true).catch(() => false)) {
                return res.status(200).json([]);
            }

            const rawData = await promises.readFile(commentPath, "utf-8");
            const allComments = JSON.parse(rawData);

            //console.log(`📜 Loaded ${allComments.length} comments from ${commentPath}`);
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
    const decryptedChat = chat.loadAndDecryptChat();
    clients.forEach((client) => {
        client.write(`data: ${JSON.stringify(decryptedChat)}\n\n`);
    });
}

// asynchronously track changes in chat.json every 1 second and update clients if changes are detected (use promises from fs)
async function trackChatChanges() {
    let lastChatData = await promises.readFile(chat_json_path, "utf-8");
    console.log(`📔 Tracking chat changes in ${chat_json_path}`);
    setInterval(async () => {
        const newChatData = await promises.readFile(chat_json_path, "utf-8");
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

server.start();
trackChatChanges();
console.log(`🚀 Kitty Server is running on https://${HOST}:${PORT}`);