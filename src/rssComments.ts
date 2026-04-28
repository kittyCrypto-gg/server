import { Request, Response } from "express";
import KittyRequest from "./kittyRequest";
import { tokenStore } from "./tokenStore";
import Server from "./baseServer";
import { OpenAI } from "openai";
import path from "path";
import fs from "fs";
/* @ts-ignore */
import "dotenv/config";

const apiKey = process.env.OPENAI_KEY || "";
const openai = new OpenAI({ apiKey });

interface ModeratorStrings {
    role?: string;
    user?: string;
}

export interface RssCommentData {
    slug: string;
    nick: string;
    msg: string;
    ip: string;
    sessionToken: string;
    timestamp: string;
    id: string;
    website?: string;
    location?: string;
}

function isValidURL(value: string): boolean {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

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
        try {
            const raw = fs.readFileSync(this.stringsFilePath, "utf-8");
            const parsed = JSON.parse(raw) as unknown;

            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return {};
            }

            return parsed as { [key: string]: ModeratorStrings };
        } catch {
            throw new Error("Could not load moderator strings.");
        }
    }

    private safeDecode(value: string): string {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }

    private async moderateComment(rawMsg: string): Promise<string> {
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content:
                            this.strings.moderator?.role ||
                            "You are a moderator. Please moderate the following message:"
                    },
                    {
                        role: "user",
                        content: `The user submitted the following RSS post comment:\n\n${rawMsg}`
                    }
                ]
            });

            return response.choices[0].message.content ?? "Error moderating comment.";
        } catch (error) {
            console.error("❌ RSS comment AI moderation failed:", error);
            return "ERROR";
        }
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
        if (typeof data !== "object" || data === null) {
            return false;
        }

        const comment = data as RssCommentData;

        return (
            typeof comment.slug === "string" &&
            typeof comment.nick === "string" &&
            typeof comment.msg === "string" &&
            typeof comment.ip === "string" &&
            typeof comment.sessionToken === "string" &&
            typeof comment.timestamp === "string" &&
            typeof comment.id === "string" &&
            (comment.website === undefined || typeof comment.website === "string") &&
            (comment.location === undefined || typeof comment.location === "string")
        );
    }
}

export default RssComment;