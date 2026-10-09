import * as ImageTransformer from "./imageTransformer";
import Comment, { CommentData } from "./kittyComment";
import { GithubAutoScheduler } from "./blogScheduler";
import express, { Request, Response } from "express";
import { ExtVisitsStore } from "./extVisits";
import * as helpers from "./serverHelpers";
import { normaliseCommentPage } from "./commentPage";
import { tokenStore } from "./tokenStore";
import { TrSites } from "./trustedSites";
import rateLimiter from "./rateLimiter";
import RssComment from "./rssComments";
import { VisitsStore } from "./visits";
import { renderPage } from "./render";
import Server from "./baseServer";
import * as types from "./types";
import fetch from "node-fetch";
import Chat from "./kittyChat";
import argon2 from "argon2";
import path from "path";


import cors from "cors";
import fs from "fs";
/* @ts-ignore */
import "dotenv/config";
import type { KittyRouteContext } from "./kittyServer/routes/context";
import { registerSessionRoutes } from "./kittyServer/routes/sessions";
import { registerChatStreamRoutes } from "./kittyServer/routes/chatStream";
import { registerCommentRoutes } from "./kittyServer/routes/comments";
import { registerContentRoutes } from "./kittyServer/routes/content";
import { registerAllowedSourceRoutes } from "./kittyServer/routes/allowedSources";
import { registerChatbotRoutes } from "./kittyServer/routes/chatbot";
import { registerMediaRoutes } from "./kittyServer/routes/media";
import { registerTrustedSiteRoutes } from "./kittyServer/routes/trustedSites";
import { registerVisitRoutes } from "./kittyServer/routes/visits";
import { registerSiteStatusRoutes } from "./kittyServer/routes/siteStatus";

const HOST = process.env.HOST;
const PORT = parseInt(process.env.PORT || "0");
const chatbot_PATH = path.resolve(process.cwd(), "data", "chatbot_users.gcm.json")
const CHATBOT_API_KEY = process.env.CHATBOT_API_KEY
const RENDER_TOKEN = process.env.RENDER_TOKEN || "";
const clients: types.SseClient[] = [];
const imageTransformer = new ImageTransformer.ImageTransformer();
const chat_json_path = path.resolve(process.cwd(), "data", "chat.gcm.json");
const comments_json_path = path.resolve(process.cwd(), "data", "comments.json");
const rss_comments_json_path = path.resolve(process.cwd(), "data", "rssComments.json");

const BASE_URL = process.env.BASE_URL || "https://srv.kittycrow.dev";

const allowedOrigins = [
    "https://kittycrypto.gg",
    "https://nojs.kittycrypto.gg",
    "https://api.kittycrypto.gg",
    "https://app.kittycrypto.gg",
    "https://chat.kittycrypto.gg",
    "https://srv.kittycrypto.gg",
    "https://kittycrypto-gg.translate.goog",
    "https://test.kittycrypto.gg",

    "https://kittycrow.dev",
    "https://nojs.kittycrow.dev",
    "https://api.kittycrow.dev",
    "https://app.kittycrow.dev",
    "https://chat.kittycrow.dev",
    "https://srv.kittycrow.dev",
    "https://kittycrow-dev.translate.goog",
    "https://test.kittycrow.dev"
];

const sitesToMap = new Set<string>([
    "",
    "about.html",
    "blog.html",
    "chat.html",
    "reader.html"
])

const RateLimiter = new rateLimiter({
    filePath: path.resolve(process.cwd(), "data", "rateLimits.json")
});

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

const blogger = new GithubAutoScheduler({
    owner: "KittyCrypto-gg",
    repos: ["server", "website"],
    blogUser: "autoKitty"
});

// Initialise the HTTPS server
const server = new Server(HOST, PORT, allowedOrigins);

server.app.use(express.urlencoded({ extended: false }))
server.app.use(express.json())
server.app.set("trust proxy", true)
server.addPubCorsRte("/visits/log/*", "POST")
server.addPubCorsRte("/visits/stats/*", "GET")
helpers.registerAppDiscoveryEndpoint(server)

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
const rssComment = new RssComment(server, rss_comments_json_path, TokenStore);

const allowedSourcesPath = path.resolve(process.cwd(), "data", "allowedSources.json");

const storiesRoot = path.resolve(process.cwd(), "stories");

const visits = new VisitsStore()

const trustedSites = new TrSites({
    srvBaseUrl: BASE_URL,
    verificationPath: "/.well-known/kittycrow.key"
});

const externalVisits = new ExtVisitsStore({
    rootDirPath: path.resolve(process.cwd(), "data", "visits")
});


const routeContext: KittyRouteContext = {
    server,
    TokenStore,
    chat,
    clients,
    comments_json_path,
    storiesRoot,
    sitesToMap,
    allowedSourcesPath,
    CHATBOT_API_KEY,
    chatbot_PATH,
    imageTransformer,
    RENDER_TOKEN,
    RateLimiter,
    trustedSites,
    BASE_URL,
    visits,
    externalVisits
};

registerSessionRoutes(routeContext);
registerChatStreamRoutes(routeContext);
registerCommentRoutes(routeContext);

chat.onNewMessage = async () => {
    await helpers.notifyClients(chat, clients);
};


registerContentRoutes(routeContext);
registerAllowedSourceRoutes(routeContext);
registerChatbotRoutes(routeContext);
registerMediaRoutes(routeContext);
registerTrustedSiteRoutes(routeContext);
registerVisitRoutes(routeContext);
registerSiteStatusRoutes(routeContext);


server.start();
void helpers.trackChatChanges(chat_json_path, chat, clients).catch((error: unknown) => {
    console.error("❌ Failed to start chat tracking:", error);
});

console.log(chat.readyMessage());
console.log(comment.readyMessage());
console.log(rssComment.readyMessage());

console.log(`🚀 Kitty Server is running on https://${HOST}:${PORT}`);

// blogger.runOnceNow();
