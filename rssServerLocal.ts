import RssServer from './rssServer';
import path from "path";
import matter from "gray-matter";
import { Feed } from "feed";
import * as fs from "fs/promises";

interface LocalPost {
    title: string;
    date: string; // ISO 8601
    slug: string;
    summary?: string;
    author?: string;
    tags?: string[];
    content: string;
    image?: string;
}

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
    private localPostsDir: string = "./blogposts";
    private localFeedSlug: string = "kittycrypto";
    private localFeedTitle: string = "Kitty’s Blog";
    private localFeedDescription: string = "Personal posts from Kitty’s blog";

    constructor(host: string, port?: number) {
        
        const allowedOrigins = [
            "https://kittycrypto.gg",
            "https://www.kittycrypto.gg",
            "https://test.kittycrypto.gg",
            "https://render.kittycrypto.gg"
        ];

        super(host, port, allowedOrigins);
        this.registerLocalBlogRoute();
    }

    private async loadLocalPosts(): Promise<LocalPost[]> {
        const postsDir = this.localPostsDir;
        const files = await fs.readdir(postsDir);
        const mdFiles = files.filter(f => f.endsWith('.md'));

        const posts: LocalPost[] = [];

        for (const file of mdFiles) {
            const filePath = path.join(postsDir, file);
            const raw = await fs.readFile(filePath, "utf-8");

            // Parse front matter & content
            const parsed = matter(raw);
            const data = parsed.data;
            const content = parsed.content.trim();

            // Validate required fields
            if (!data.title || !data.date) {
                console.warn(`File ${file} is missing title or date in front matter. Skipping.`);
                continue;
            }

            // Generate slug from filename if not provided
            const slug = data.slug || file.replace(/\.md$/, '');

            posts.push({
                title: data.title,
                date: new Date(data.date).toISOString(),
                slug,
                summary: data.summary,
                author: data.author || "Kitty",
                tags: Array.isArray(data.tags) ? data.tags : undefined,
                content,
                image: data.image,
            });
        }

        // Sort by date, descending (newest first)
        posts.sort((a, b) => b.date.localeCompare(a.date));

        return posts;
    }

    private generateLocalRSS(posts: LocalPost[]): Feed {
        // Use the current host and port from the server instance
        const baseUrl = `https://${this.host}:${this.port}`;

        const feed = new Feed({
            title: this.localFeedTitle,
            description: this.localFeedDescription,
            id: `${baseUrl}/rss/${this.localFeedSlug}`,
            link: `${baseUrl}/rss/${this.localFeedSlug}`,
            copyright: `All Rights Reserved, ${(new Date()).getFullYear()}`,
            author: { name: "Kitty" },
            updated: new Date(posts[0]?.date || Date.now()), // Use the most recent post date
            feedLinks: {
                rss: `${baseUrl}/rss/${this.localFeedSlug}`,
                atom: `${baseUrl}/rss/${this.localFeedSlug}.atom`
            },
            generator: "KittyCrypto RSS Server"
        });

        for (const post of posts) {
            feed.addItem({
                title: post.title,
                id: `${baseUrl}/rss/${this.localFeedSlug}#${post.slug}`,
                link: `${baseUrl}/rss/${this.localFeedSlug}#${post.slug}`,
                date: new Date(post.date),
                description: post.summary,
                author: post.author ? [{ name: post.author }] : [{ name: "Kitty" }],
                content: post.content,
                image: post.image
            });
        }

        return feed;
    }


    private registerLocalBlogRoute() {
        this.app.get(`/rss/${this.localFeedSlug}`, async (_req, res) => {
            // Log every time the RSS XML is opened
            console.log("📤 RSS feed served: /rss/" + this.localFeedSlug);
            try {
                // Load local posts
                const posts = await this.loadLocalPosts();
                // Generate RSS feed object
                const feed = this.generateLocalRSS(posts);
                let xml = feed.rss2();

                // Inject <author> for each item
                posts.forEach(post => {
                    // Escape special characters for regex
                    const safeTitle = post.title.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    // Match the item's <title>...<description>
                    const re = new RegExp(
                        `(<title><!\\[CDATA\\[${safeTitle}\\]\\]><\\/title>[\\s\\S]*?<description>[\\s\\S]*?<\\/description>)`
                    );
                    xml = xml.replace(
                        re,
                        `$1\n<author>${post.author || 'Kitty'}</author>`
                    );
                });

                res.set("Content-Type", "application/xml");
                res.send(xml);

            } catch (error) {
                console.error(`Error generating local RSS feed:`, error);
                res.status(500).send("Error generating RSS feed");
            }
        });

        // console.log(
        //     `🐾 Registered local blog RSS endpoint: https://${this.host}:${this.port}/rss/${this.localFeedSlug}`
        // );
    }

}

if (require.main === module) {
    (async () => {
        const host = HOST;
        const port = RSS_PORT;
        const rssServerLocal = new RssServerLocal(host, port);
        await rssServerLocal.start();
        console.log(`🐾 Kitty's local RSS server running at https://${host}:${port}/rss/kittycrypto`);
    })();
}
