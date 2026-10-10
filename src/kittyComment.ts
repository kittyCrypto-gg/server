import { Request, Response } from "express";
import KittyRequest from "./kittyRequest";
import { tokenStore } from "./tokenStore";
import Server from "./baseServer";
import { OpenAI } from "openai";
import path from "path";
import { normaliseCommentPage } from "./commentPage";
import { isValidURL, loadModeratorStrings, moderateSubmittedComment, type ModeratorStrings } from "./comments/shared";
/* @ts-ignore */
import "dotenv/config";

const apiKey = process.env.OPENAI_KEY || "";
const openai = new OpenAI({ apiKey });

export interface CommentData {
  page: string;
  nick: string;
  msg: string;
  ip: string;
  sessionToken: string;
  timestamp: string;
  id: string;
  website?: string;
  location?: string;
}

class Comment extends KittyRequest<CommentData> {
  private strings: { [key: string]: ModeratorStrings } = {};
  private ready: boolean = false;
  private readonly stringsFilePath: string;

  public constructor(server: Server, commentsPath: string, TokenStore: tokenStore) {
    super(server, commentsPath, TokenStore, Comment.isValidComment);
    this.stringsFilePath = path.resolve(process.cwd(), "data", "strings.json");

    try {
      this.strings = this.loadModeratorStrings();
    } catch {
      console.warn("⚠️ Could not load strings.json for moderator.");
      this.ready = false;
      return;
    }

    try {
      this.server.app.post("/comment", async (req: Request, res: Response) => {
        await this.handleRequest(req, res, () => this.storeComment(req, res));
      });

      this.ready = true;
    } catch (error) {
      console.error("❌ Failed to register /comment endpoint:", error);
      this.ready = false;
    }
  }

  private loadModeratorStrings(): { [key: string]: ModeratorStrings } {
    return loadModeratorStrings(this.stringsFilePath);
  }

  private async moderateComment(rawMsg: string): Promise<string> {
    return moderateSubmittedComment(rawMsg, this.strings, openai, "comment", "❌ AI moderation failed:");
  }

  private async storeComment(req: Request, res: Response): Promise<object> {
    const body: unknown = req.body;

    if (!Comment.isValidComment(body)) {
      return { error: "Invalid comment format." };
    }

    if (body.website !== undefined && !isValidURL(body.website)) {
      return { error: "Invalid website URL." };
    }

    if (!this.sessionTokens.has(body.sessionToken)) {
      return { error: "Invalid session token." };
    }

    const comment: CommentData = {
      ...body,
      page: normaliseCommentPage(decodeURIComponent(body.page)),
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
      ? "💭 Comment system is ready."
      : "⚠️ Comment system is not ready. Something went wrong.";
  }

  static isValidComment(data: unknown): data is CommentData {
    if (typeof data !== "object" || data === null) {
      return false;
    }

    const comment = data as CommentData;

    return (
      typeof comment.page === "string" &&
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

export default Comment;