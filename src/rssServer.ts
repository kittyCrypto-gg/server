import { aiParser } from "./aiParser";
import Server from "./baseServer";
import { Feed } from "feed";
/* @ts-ignore */
import "dotenv/config";
import type { MetaDoc, ScrapedArticle } from "./rssServer/types";
import { loadSources, slugify } from "./rssServer/sources";
import { extractMetaDate, extractDateFromText } from "./rssServer/dates";
import { fetchAndCacheRSS, generateRSS } from "./rssServer/feed";
import { fetchReadableContent, fetchArticlesFromSource } from "./rssServer/articles";

const HOST = process.env.HOST;

if (!HOST) {
    console.error("❌ HOST environment variable is not set. Exiting.");
    process.exit(1);
}

const PORT = parseInt(process.env.PORT || "0");

if (isNaN(PORT) || PORT <= 0 || PORT > 65535) {
    console.error("❌ PORT environment variable is not set or invalid. Exiting.");
    process.exit(1);
}

class RssServer extends Server {
    private feeds: Map<string, Feed>;
    private aiParser: aiParser;

    constructor(host: string, port?: number, allowedOrigins?: string | string[]) {
        super(host, port, allowedOrigins);
        this.feeds = new Map();
        this.aiParser = new aiParser(process.env.OPENAI_KEY!);

        this.loadSources()
            .then(sources => this.registerRoutes(sources))
            .catch(error => console.error("Error loading sources:", error));
    }


    private async loadSources(): Promise<string[]> {
        return await loadSources();
    }

    private async fetchAndCacheRSS(source: string, cacheFile: string): Promise<boolean> {
        return await fetchAndCacheRSS(source, cacheFile);
    }

    private async fetchReadableContent(url: string): Promise<ScrapedArticle | null> {
        return await fetchReadableContent(url, dom => this.extractMetaDate(dom), text => this.extractDateFromText(text), this.aiParser);
    }

    private extractMetaDate(dom: MetaDoc): string | null {
        return extractMetaDate(dom);
    }

    private extractDateFromText(text: string): string | null {
        return extractDateFromText(text);
    }

    private async generateRSS(source: string): Promise<Feed> {
        return await generateRSS({
            slugify: url => this.slugify(url),
            fetchAndCacheRSS: (url, file) => this.fetchAndCacheRSS(url, file),
            fetchArticlesFromSource: (url, existing) => this.fetchArticlesFromSource(url, existing)
        }, source);
    }

    private async fetchArticlesFromSource(source: string, existingArticles: Set<string>): Promise<ScrapedArticle[]> {
        return await fetchArticlesFromSource(source, existingArticles, url => this.fetchReadableContent(url));
    }

    private slugify(url: string): string {
        return slugify(url);
    }

    private async registerRoutes(sources: string[]) {
        for (const source of sources) {
            const slug = this.slugify(source);
            this.app.get(`/rss/${slug}`, async (_req, res) => {
                try {
                    const rssFeed = await this.generateRSS(source);
                    res.set("Content-Type", "application/xml");
                    res.send(rssFeed.rss2());
                } catch (error) {
                    console.error(`Error generating RSS for ${source}:`, error);
                    res.status(500).send("Error generating RSS feed");
                }
            });
        }

        // console.log("Registered endpoints:");
        // sources.forEach(source => console.log(`https://${this.host}:${this.port}/rss/${this.slugify(source)}`));
    }
}

if (require.main === module) {
    (async () => {
        const host = HOST;
        const rssServer = new RssServer(host);
        await rssServer.start();
    })();
}

export default RssServer;
