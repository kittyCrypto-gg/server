import { Request, Response } from "express";
import KittyRequest from "./kittyRequest";
import { tokenStore } from "./tokenStore";
import Server from "./baseServer";
import { OpenAI } from "openai";
import path from "path";
/* @ts-ignore */
import "dotenv/config";
import type { RssCommentData, ModeratorStrings } from "./rssComments/types";
import { isValidURL, isValidRssComment, safeDecode } from "./rssComments/validation";
import { loadModeratorStrings } from "./rssComments/stringLoader";
import { moderateComment } from "./rssComments/moderation";

export type { RssCommentData } from "./rssComments/types";

const apiKey = process.env.OPENAI_KEY || "";
const openai = new OpenAI({ apiKey });

class RssComment extends KittyRequest<RssCommentData> {
    private strings: { [key: string]: ModeratorStrings } = {};
    private ready: boolean = false;
    private readonly stringsFilePath: string;

    public constructor(server: Server, commentsPath: string, TokenStore: tokenStore) {
        super(server, commentsPath, TokenStore, RssComment.isValidRssComment);
        this.stringsFilePath = path.resolve(process.cwd(), "data", "strings.json");

        try {
            this.strings = this.loadModeratorStrings();
        } catch {
            console.warn("⚠️ Could not load strings.json for RSS comment moderator.");
            this.ready = false;
            return;
        }

        try {
            this.server.app.get("/comments/rss/load", async (req: Request, res: Response) => {
                await this.loadComments(req, res);
            });

            this.server.app.post("/comments/rss/post", async (req: Request, res: Response) => {
                await this.handleRequest(req, res, () => this.storeComment(req, res));
            });

            this.ready = true;
        } catch (error) {
            console.error("❌ Failed to register RSS comment endpoints:", error);
            this.ready = false;
        }
    }

    private loadModeratorStrings(): { [key: string]: ModeratorStrings } {
        return loadModeratorStrings(this.stringsFilePath);
    }

    private safeDecode(value: string): string {
        return safeDecode(value);
    }

    private async moderateComment(rawMsg: string): Promise<string> {
        return await moderateComment(rawMsg, this.strings, openai);
    }

    private async loadComments(req: Request, res: Response): Promise<void> {
        try {
            const rawSlug = typeof req.query.slug === "string" ? req.query.slug : "";
            const slug = this.safeDecode(rawSlug).trim();

            if (!slug) {
                res.status(400).json({ error: "Missing or invalid 'slug' query parameter." });
                return;
            }

            const comments = await this.readFileData();
            const matchingComments = comments.filter((comment) => comment.slug === slug);

            res.status(200).json(matchingComments);
        } catch (error) {
            console.error("❌ Error retrieving RSS comments:", error);
            res.status(500).json({ error: "Failed to load RSS comments." });
        }
    }

    private async storeComment(req: Request, _res: Response): Promise<object> {
        const body: unknown = req.body;

        if (!RssComment.isValidRssComment(body)) {
            return { error: "Invalid RSS comment format." };
        }

        if (body.website !== undefined && !isValidURL(body.website)) {
            return { error: "Invalid website URL." };
        }

        if (!this.sessionTokens.has(body.sessionToken)) {
            return { error: "Invalid session token." };
        }

        const comment: RssCommentData = {
            ...body,
            slug: this.safeDecode(body.slug).trim(),
            location:
                typeof body.location === "string" && body.location.trim().length > 0
                    ? body.location
                    : "world"
        };

        const safeMsg = await this.moderateComment(comment.msg);

        if (safeMsg === "ERROR") {
            return { error: "AI moderation failed. Please try again later." };
        }

        comment.msg = safeMsg;
        await this.saveToFile(comment);

        return { success: true, received: comment.id };
    }

    public readyMessage(): string {
        return this.ready
            ? "💬 RSS comment system is ready."
            : "⚠️ RSS comment system is not ready. Something went wrong.";
    }

    static isValidRssComment(data: unknown): data is RssCommentData {
        return isValidRssComment(data);
    }
}

export default RssComment;
