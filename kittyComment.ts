import { Request, Response } from "express";
import Server from "./baseServer";
import KittyRequest from "./kittyRequest";
import { OpenAI } from "openai";
import fs from "fs";

const apiKey = process.env.OPENAI_KEY || "";
const openai = new OpenAI({ apiKey });

interface ModeratorStrings {
  role?: string;
  user?: string;
}

export interface CommentData {
  page: string;
  nick: string;
  msg: string;
  ip: string;
  sessionToken: string;
  timestamp: string;
  id: string;
}

class Comment extends KittyRequest<CommentData> {
  private strings: { [key: string]: ModeratorStrings } = {};
  constructor(server: Server, sessionTokens: Set<string>) {
    super(server, "./comments.json", sessionTokens, Comment.isValidComment);

    try {
      this.strings = JSON.parse(fs.readFileSync("./strings.json", "utf-8"));
    } catch {
      console.warn("⚠️ Could not load strings.json for moderator.");
    }

    // ✅ Register the POST /comment endpoint directly here
    this.server.app.post("/comment", async (req: Request, res: Response) => {
      await this.handleRequest(req, res, () => this.storeComment(req, res));
    });
  }

  private async moderateComment(rawMsg: string): Promise<string> {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: this.strings.moderator?.role || "You are a moderator. Please moderate the following message:",
          },
          {
            role: "user",
            content: `The user submitted the following comment:\n\n${rawMsg}`,
          },
        ],
      });

      return response.choices[0].message.content ?? "Error moderating comment.";
    } catch (error) {
      console.error("❌ AI moderation failed:", error);
      return "ERROR";
    }
  }

  private async storeComment(req: Request, res: Response): Promise<object> {
    const body = req.body;

    if (!Comment.isValidComment(body)) {
      return { error: "Invalid comment format." };
    }

    if (!Comment.sessionTokens.has(body.sessionToken)) {
      return { error: "Invalid session token." };
    }
    
    body.page = decodeURIComponent(body.page);
    const safeMsg = await this.moderateComment(body.msg);

    if (safeMsg === "ERROR") {
      return { error: "AI moderation failed. Please try again later." };
    }

    body.msg = safeMsg;
    this.saveToFile(body);
    return { success: true, received: body.id };
  }

  static isValidComment(data: unknown): data is CommentData {
    return (
      typeof data === "object" &&
      data !== null &&
      "page" in data &&
      "nick" in data &&
      "msg" in data &&
      "ip" in data &&
      "sessionToken" in data &&
      "timestamp" in data &&
      "id" in data &&
      typeof (data as CommentData).page === "string" &&
      typeof (data as CommentData).nick === "string" &&
      typeof (data as CommentData).msg === "string" &&
      typeof (data as CommentData).ip === "string" &&
      typeof (data as CommentData).sessionToken === "string" &&
      typeof (data as CommentData).timestamp === "string" &&
      typeof (data as CommentData).id === "string"
    );
  }
}

export default Comment;
