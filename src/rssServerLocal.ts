import RssServer from "./rssServer";
import * as fs from "fs/promises";
import matter from "gray-matter";
import { Feed } from "feed";
import path from "path";
import { createHash } from "crypto";
import "dotenv/config";

interface LocalPost {
    title: string;
    date: string;
    slug: string;
    postId: string;
    summary?: string;
    author?: string;
    tags?: string[];
    content: string;
    image?: string;
}

type LocalPostDraft = Omit<LocalPost, "postId">;

const HOST = process.env.HOST;

if (!HOST) {
    console.error("❌ HOST environment variable is not set. Exiting.");
    process.exit(1);
}

const RSS_PORT = parseInt(process.env.RSS_PORT || "0");

if (isNaN(RSS_PORT) || RSS_PORT <= 0 || RSS_PORT > 65535) {
    console.error("❌ RSS_PORT environment variable is not set or invalid. Exiting.");
    process.exit(1);
}

class RssServerLocal extends RssServer {
    private localPostsDir: string = path.resolve(process.cwd(), "data", "blogposts");
    private localFeedSlug: string = "kittycrypto";
    private localFeedTitle: string = "Kitty’s Blog";
    private localFeedDescription: string = "Personal posts from Kitty’s blog";

    constructor(host: string, port?: number) {
        const allowedOrigins = [
            "https://kittycrypto.gg",
            "https://www.kittycrypto.gg",
            "https://test.kittycrypto.gg",
            "https://render.kittycrypto.gg",
            "http://localhost:8080"
        ];

        super(host, port, allowedOrigins);
        this.registerLocalBlogRoute();
    }

    private readAuthorLine(raw: string): string | null {
        const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
        const body = frontMatter?.[1] ?? "";

        const line = body
            .split(/\r?\n/)
            .find((entry) => /^\s*author\s*:/.test(entry));

        if (!line) return null;

        const rawAuthor = line
            .replace(/^\s*author\s*:\s*/, "")
            .trim();

        const author = rawAuthor
            .replace(/^["']/, "")
            .replace(/["']$/, "")
            .trim();

        return author.length > 0 ? author : null;
    }

    private escapeXml(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    private readString(value: unknown): string | null {
        if (typeof value !== "string") return null;

        const clean = value.trim();
        return clean.length > 0 ? clean : null;
    }

    private readIsoDate(value: unknown): string | null {
        const date =
            value instanceof Date
                ? value
                : typeof value === "string" || typeof value === "number"
                    ? new Date(value)
                    : null;

        if (!date) return null;
        if (Number.isNaN(date.getTime())) return null;

        return date.toISOString();
    }

    private readTags(value: unknown): string[] | undefined {
        if (!Array.isArray(value)) return undefined;

        const tags = value
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);

        return tags.length > 0 ? tags : undefined;
    }

    private makePostId(post: LocalPostDraft): string {
        const seed = [
            this.localFeedSlug,
            post.slug,
            post.date,
            post.title,
            post.author || "Kitty"
        ].join("\u001F");

        return createHash("sha256")
            .update(seed, "utf8")
            .digest("hex");
    }

    private async loadLocalPosts(): Promise<LocalPost[]> {
        const postsDir = this.localPostsDir;
        const files = await fs.readdir(postsDir);
        const mdFiles = files.filter((file) => file.endsWith(".md"));

        const posts: LocalPost[] = [];

        for (const file of mdFiles) {
            const filePath = path.join(postsDir, file);
            const raw = await fs.readFile(filePath, "utf-8");

            const parsed = matter(raw);
            const data = parsed.data as Record<string, unknown>;
            const content = parsed.content.trim();

            const title = this.readString(data.title);
            const date = this.readIsoDate(data.date);

            if (!title || !date) {
                console.warn(`File ${file} is missing title or date in front matter. Skipping.`);
                continue;
            }

            const slug = this.readString(data.slug) || file.replace(/\.md$/, "");
            const author = this.readAuthorLine(raw) || this.readString(data.author) || "Kitty";

            const postDraft: LocalPostDraft = {
                title,
                date,
                slug,
                summary: this.readString(data.summary) ?? undefined,
                author,
                tags: this.readTags(data.tags),
                content,
                image: this.readString(data.image) ?? undefined
            };

            posts.push({
                ...postDraft,
                postId: this.makePostId(postDraft)
            });
        }

        posts.sort((a, b) => b.date.localeCompare(a.date));

        return posts;
    }

    private generateLocalRSS(posts: readonly LocalPost[]): Feed {
        const baseUrl = `https://rss.kittycrypto.gg`;

        const feed = new Feed({
            title: this.localFeedTitle,
            description: this.localFeedDescription,
            id: `${baseUrl}/rss/${this.localFeedSlug}`,
            link: `${baseUrl}/rss/${this.localFeedSlug}`,
            copyright: `All Rights Reserved, ${(new Date()).getFullYear()}`,
            author: { name: "Kitty" },
            updated: new Date(posts[0]?.date || Date.now()),
            feedLinks: {
                rss: `${baseUrl}/rss/${this.localFeedSlug}`,
                atom: `${baseUrl}/rss/${this.localFeedSlug}.atom`
            },
            generator: "KittyCrypto RSS Server"
        });

        for (const post of posts) {
            feed.addItem({
                title: post.title,
                id: `${baseUrl}/rss/${this.localFeedSlug}#${post.postId}`,
                link: `${baseUrl}/rss/${this.localFeedSlug}#${post.postId}`,
                date: new Date(post.date),
                description: post.summary,
                author: post.author ? [{ name: post.author }] : [{ name: "Kitty" }],
                content: post.content,
                image: post.image
            });
        }

        return feed;
    }

    private registerLocalBlogRoute(): void {
        this.app.get(`/rss/${this.localFeedSlug}`, async (_req, res) => {
            console.log("📤 RSS feed served: /rss/" + this.localFeedSlug);

            try {
                const posts = await this.loadLocalPosts();
                const feed = this.generateLocalRSS(posts);
                let xml = feed.rss2();

                let postIx = 0;

                xml = xml.replace(
                    /<\/item>/g,
                    (match: string): string => {
                        const post = posts[postIx];
                        postIx += 1;

                        if (!post) return match;

                        return [
                            `<author>${this.escapeXml(post.author || "Kitty")}</author>`,
                            `<postId>${this.escapeXml(post.postId)}</postId>`,
                            match
                        ].join("\n");
                    }
                );

                res.set("Content-Type", "application/xml");
                res.send(xml);
            } catch (error) {
                console.error("Error generating local RSS feed:", error);
                res.status(500).send("Error generating RSS feed");
            }
        });
    }
}

if (require.main === module) {
    (async () => {
        const host = HOST;
        const port = RSS_PORT;
        const rssServerLocal = new RssServerLocal(host, port);

        await rssServerLocal.start();

        console.log(`🐾 Kitty's local RSS server running at https://rss.kittycrypto.gg/rss/kittycrypto`);
    })();
}