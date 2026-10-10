import * as fs from "fs/promises";
import matter from "gray-matter";
import path from "path";
import type { LocalPost, LocalPostDraft } from "./types";
export interface LocalPostsContext {
readAuthorLine(raw: string): string | null;
readString(value: unknown): string | null;
readIsoDate(value: unknown): string | null;
readTags(value: unknown): string[] | undefined;
makePostId(post: LocalPostDraft): string;
}
    export async function loadLocalPosts(postsDir: string, ctx: LocalPostsContext): Promise<LocalPost[]> {
        const files = await fs.readdir(postsDir);
        const mdFiles = files.filter((file) => file.endsWith(".md"));

        const posts: LocalPost[] = [];

        for (const file of mdFiles) {
            const filePath = path.join(postsDir, file);
            const raw = await fs.readFile(filePath, "utf-8");

            const parsed = matter(raw);
            const data = parsed.data as Record<string, unknown>;
            const content = parsed.content.trim();

            const title = ctx.readString(data.title);
            const date = ctx.readIsoDate(data.date);

            if (!title || !date) {
                console.warn(`File ${file} is missing title or date in front matter. Skipping.`);
                continue;
            }

            const slug = ctx.readString(data.slug) || file.replace(/\.md$/, "");
            const author = ctx.readAuthorLine(raw) || ctx.readString(data.author) || "Kitty";

            const postDraft: LocalPostDraft = {
                title,
                date,
                slug,
                summary: ctx.readString(data.summary) ?? undefined,
                author,
                tags: ctx.readTags(data.tags),
                content,
                image: ctx.readString(data.image) ?? undefined
            };

            posts.push({
                ...postDraft,
                postId: ctx.makePostId(postDraft)
            });
        }

        posts.sort((a, b) => b.date.localeCompare(a.date));

        return posts;
    }

