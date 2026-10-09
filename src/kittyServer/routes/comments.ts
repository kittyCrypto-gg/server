import type { Request, Response } from "express";
import type { CommentData } from "../../kittyComment";
import { normaliseCommentPage } from "../../commentPage";
import fs from "fs";
import type { KittyRouteContext } from "./context";

/** Registers existing routes with their original handlers and middleware. */
export function registerCommentRoutes({ server, comments_json_path }: Pick<KittyRouteContext, "server" | "comments_json_path">): void {
server.app.get("/comments/load",
    async (req: Request, res: Response) => {
        try {
            const rawPage = typeof req.query.page === "string" ? req.query.page : "";
            const page = normaliseCommentPage(decodeURIComponent(rawPage));

            console.log("🔍 Loading comments for page:", page);

            if (!page) {
                res.status(400).json({ error: "Missing or invalid 'page' query parameter." });
                return;
            }

            const commentsFileExists = await fs.promises
                .stat(comments_json_path)
                .then(() => true)
                .catch(() => false);

            if (!commentsFileExists) {
                res.status(200).json([]);
                return;
            }

            const rawData = await fs.promises.readFile(comments_json_path, "utf-8");
            const allComments = JSON.parse(rawData);

            if (!Array.isArray(allComments)) {
                throw new Error("Invalid comment store format.");
            }

            const matchingComments = allComments.filter(
                (comment: CommentData) => normaliseCommentPage(comment.page) === page
            );

            console.log(`📜 Found ${matchingComments.length} comments for page: ${page}`);
            res.status(200).json(matchingComments);
        } catch (error) {
            console.error("❌ Error retrieving comments:", error);
            res.status(500).json({ error: "Failed to load comments." });
        }
    }
);

}
