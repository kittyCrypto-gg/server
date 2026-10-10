import RssServer from "./rssServer";
import { Feed } from "feed";
import path from "path";
import "dotenv/config";
import type { LocalPost, LocalPostDraft } from "./rssServerLocal/types";
import { readAuthorLine, readString, readIsoDate, readTags, makePostId } from "./rssServerLocal/metadata";
import { loadLocalPosts } from "./rssServerLocal/posts";
import { escapeXml, generateLocalRSS, addLocalPostXmlMetadata } from "./rssServerLocal/feed";

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
            
            "https://kittycrow.dev",
            "https://www.kittycrow.dev",
            "https://test.kittycrow.dev",
            "https://render.kittycrow.dev"
        ];

        super(host, port, allowedOrigins);
        this.registerLocalBlogRoute();
    }

    private readAuthorLine(raw: string): string | null { return readAuthorLine(raw); }
    private escapeXml(value: string): string { return escapeXml(value); }
    private readString(value: unknown): string | null { return readString(value); }
    private readIsoDate(value: unknown): string | null { return readIsoDate(value); }
    private readTags(value: unknown): string[] | undefined { return readTags(value); }
    private makePostId(post: LocalPostDraft): string { return makePostId(post, this.localFeedSlug); }
    private async loadLocalPosts(): Promise<LocalPost[]> {
        return await loadLocalPosts(this.localPostsDir, {
            readAuthorLine: raw => this.readAuthorLine(raw),
            readString: value => this.readString(value),
            readIsoDate: value => this.readIsoDate(value),
            readTags: value => this.readTags(value),
            makePostId: post => this.makePostId(post)
        });
    }
    private generateLocalRSS(posts: readonly LocalPost[]): Feed {
        return generateLocalRSS(posts, {
            slug: this.localFeedSlug,
            title: this.localFeedTitle,
            description: this.localFeedDescription
        });
    }
    private registerLocalBlogRoute(): void {
        this.app.get(`/rss/${this.localFeedSlug}`, async (_req, res) => {
            console.log("📤 RSS feed served: /rss/" + this.localFeedSlug);

            try {
                const posts = await this.loadLocalPosts();
                const feed = this.generateLocalRSS(posts);
                let xml = feed.rss2();
                xml = addLocalPostXmlMetadata(xml, posts, value => this.escapeXml(value));

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