import { Request, Response } from "express";
import Server from "./baseServer";
import KittyRequest from "./kittyRequest";
import { tokenStore } from "./tokenStore";
import { OpenAI } from "openai";
import fs from "fs";
import path from "path";
/* @ts-ignore */
import "dotenv/config";

const apiKey = process.env.OPENAI_KEY || "";
const openai = new OpenAI({ apiKey });

interface ModeratorStrings {
  role?: string;
  user?: string;
}

function isValidURL(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function resolveLocation(value: unknown): string {
  if (typeof value !== "string") {
    return "world";
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? "world" : trimmed;
}

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

  constructor(server: Server, commentsPath: string, TokenStore: tokenStore) {
    super(server, commentsPath, TokenStore, Comment.isValidComment);
    this.stringsFilePath = path.resolve(process.cwd(), "data", "strings.json");

    try {
      this.strings = JSON.parse(fs.readFileSync(this.stringsFilePath, "utf-8"));
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
            content: `The user submitted the following comment:\n\n${rawMsg}`
          }
        ]
      });

      return response.choices[0].message.content ?? "Error moderating comment.";
    } catch (error) {
      console.error("❌ AI moderation failed:", error);
      return "ERROR";
    }
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

    body.page = decodeURIComponent(body.page);
    body.location =
      typeof body.location === "string" && body.location.trim().length > 0
        ? body.location
        : "world";

    const safeMsg = await this.moderateComment(body.msg);

    if (safeMsg === "ERROR") {
      return { error: "AI moderation failed. Please try again later." };
    }

    body.msg = safeMsg;
    this.saveToFile(body);
    return { success: true, received: body.id };
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