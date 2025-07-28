import Server from "./baseServer";
import axios from "axios";
import { JSDOM } from "jsdom";
import { DOMParser } from '@xmldom/xmldom';
import { Readability } from "@mozilla/readability";
import { Feed } from "feed";
import fs from "fs-extra";
import nlp from 'compromise';
import dates from 'compromise-dates';
import { aiParser } from "./aiParser";
import Parser from "rss-parser";

const nlpWithDates = nlp.extend(dates);

const SOURCES_FILE = "rssSources.json";
const RSS_CACHE_DIR = "./rss";

class RssServer extends Server {
    private feeds: Map<string, Feed>;
    private aiParser: aiParser;

    constructor(host: string, port?: number) {
        super(host, port);
        this.feeds = new Map();
        this.aiParser = new aiParser(process.env.OPENAI_KEY!);

        this.loadSources()
            .then(sources => this.registerRoutes(sources))
            .catch(error => console.error("Error loading sources:", error));
    }

    private async loadSources(): Promise<string[]> {
        try {
            if (await fs.pathExists(SOURCES_FILE)) {
                const data = await fs.readFile(SOURCES_FILE, "utf-8");
                return JSON.parse(data);
            }
            throw new Error("Sources file not found");
        } catch (error) {
            console.error("Error reading sources:", error);
            return [];
        }
    }

    private async fetchAndCacheRSS(source: string, cacheFile: string): Promise<boolean> {
        const parser = new Parser();

        try {
            console.log(`🔍 Attempting to fetch RSS feed from ${source}`);
            const feed = await parser.parseURL(source);

            if (feed.items.length === 0) {
                throw new Error("RSS feed is empty.");
            }

            console.log(`✅ RSS feed found! Caching ${feed.items.length} articles.`);

            const feedXml = feed.items.map(item => `
                <item>
                    <title><![CDATA[${item.title}]]></title>
                    <link>${item.link}</link>
                    <description><![CDATA[${item.contentSnippet || ""}]]></description>
                    <pubDate>${item.pubDate || new Date().toISOString()}</pubDate>
                    <author><![CDATA[${item.creator || "Unknown"}]]></author>
                </item>
            `).join("");

            const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
                <rss version="2.0">
                    <channel>
                        <title>${feed.title}</title>
                        <link>${source}</link>
                        <description>${feed.description || ""}</description>
                        ${feedXml}
                    </channel>
                </rss>`;

            await fs.writeFile(cacheFile, xmlContent, "utf-8");
            return true; // RSS feed successfully cached

        } catch (error) {
            console.warn(`⚠️ No valid RSS feed found at ${source}. Falling back to manual fetching.`);
            return false; // RSS feed not available, fallback needed
        }
    }

    private async fetchReadableContent(url: string) {
        try {
            const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });

            const parser = new DOMParser();
            const dom = parser.parseFromString(data, "text/html");

            const doc = new JSDOM(data, { url }).window.document;
            const reader = new Readability(doc);
            const article = reader.parse();

            if (!article) throw new Error("Failed to extract content.");

            const publishedDate =
                article.publishedTime
                || this.extractMetaDate(dom)
                || this.extractDateFromText(article.textContent)
                || await this.aiParser.extractDate(article.textContent)
                || new Date().toISOString();

            return {
                title: article.title,
                content: article.textContent,
                url,
                author: article.byline || "Unknown",
                date: publishedDate,
            };
        } catch (error) {
            console.error(`❌ Error fetching content from ${url}:`, error);
            return null;
        }
    }

    private extractMetaDate(dom: any): string | null {
        const metaTags = [
            "meta[property='article:published_time']",
            "meta[name='date']",
            "meta[name='publish-date']",
            "meta[name='pubdate']",
            "meta[property='og:article:published_time']",
        ];

        for (const tag of metaTags) {
            const elements = dom.getElementsByTagName("meta");
            for (let i = 0; i < elements.length; i++) {
                const element = elements[i];
                const nameAttr = element.getAttribute("name") || element.getAttribute("property");
                const contentAttr = element.getAttribute("content");

                if (nameAttr === tag.replace(/meta\[name='|meta\[property='|\']/g, "") && contentAttr) {
                    if (!isNaN(Date.parse(contentAttr))) return contentAttr;
                }
            }
        }

        return null;
    }

    private extractDateFromText(text: string): string | null {
        const doc = nlpWithDates(text);
        const foundDates = doc.dates().json();
        if (!foundDates.length) return null;

        const parsedDate = new Date(foundDates[0].start);
        if (isNaN(parsedDate.getTime())) return null;

        return parsedDate.toISOString();
    }

    private async generateRSS(source: string): Promise<Feed> {
        const feed = new Feed({
            title: `RSS for ${source}`,
            description: `RSS feed dynamically generated from ${source}`,
            link: source,
            id: source,
            copyright: `All Rights Reserved, ${new Date().getFullYear()}`,
            author: { name: "RSS Generator" },
        });

        const slug = this.slugify(source);
        const sourceCacheDir = `${RSS_CACHE_DIR}/${slug}`;
        await fs.ensureDir(sourceCacheDir);
        const cacheFile = `${sourceCacheDir}/feed.xml`;

        // Try fetching the RSS feed first
        const success = await this.fetchAndCacheRSS(source, cacheFile);

        if (success) {
            console.log(`📂 Successfully cached RSS feed for ${source}, skipping manual fetch.`);
            return feed;
        }

        console.log(`🔄 Falling back to manual article scraping for ${source}`);

        const existingArticles = new Map<string, string>(); // Map to store URL -> Date

        // If the file does not exist, create it
        if (!await fs.pathExists(cacheFile)) {
            //console.log(`📂 Cache file not found: ${cacheFile}`);
            await fs.writeFile(cacheFile, "<?xml version='1.0' encoding='UTF-8'?><rss version='2.0'><channel></channel></rss>", "utf-8");
        }

        // If the file exists, parse it and re-add existing articles
        //console.log(`📂 Fetching from cache: ${cacheFile}`);
        const existingFeedData = await fs.readFile(cacheFile, "utf-8");
        const parser = new DOMParser();
        const existingDom = parser.parseFromString(existingFeedData, "text/xml");

        const items = existingDom.getElementsByTagName("item");
        Array.from(items).forEach(item => {
            const linkEl = item.getElementsByTagName("link")[0];
            const dateEl = item.getElementsByTagName("pubDate")[0];

            if (!linkEl || !linkEl.textContent) return; // Early exit for invalid items

            const rawLink = linkEl.textContent.trim();
            try {
                const normalisedUrl = new URL(rawLink).href;
                const existingDate = dateEl?.textContent?.trim() || null;

                existingArticles.set(normalisedUrl, existingDate || new Date().toISOString());

                // Re-add the existing item to the new feed
                feed.addItem({
                    title: item.getElementsByTagName("title")[0]?.textContent?.trim() || "Untitled",
                    link: normalisedUrl,
                    date: existingDate ? new Date(existingDate) : new Date(),
                    description: item.getElementsByTagName("description")[0]?.textContent?.trim() || "",
                    author: [{ name: "Unknown" }],
                });
            } catch (err) {
                console.error(`⚠️ Invalid URL in existing RSS feed item: ${rawLink}`);
            }
        });

        const articles = await this.fetchArticlesFromSource(source, new Set(existingArticles.keys()));

        for (const article of articles) {
            if (existingArticles.has(article.url)) continue; // Skip existing articles
            //console.log(`🆕 New article fetched: ${article.title}`);

            feed.addItem({
                title: article.title,
                link: article.url,
                description: article.content.slice(0, 200) + "...",
                author: [{ name: article.author }],
                date: new Date(article.date), // Ensure the correct date is stored
            });
        }

        await fs.writeFile(cacheFile, feed.rss2(), "utf-8");
        return feed;
    }

    private async fetchArticlesFromSource(
        source: string,
        existingArticles: Set<string>
    ): Promise<{ title: string; content: string; url: string; author: string; date: string }[]> {
        try {
            const { data } = await axios.get(source, { headers: { "User-Agent": "Mozilla/5.0" } });
            const parser = new DOMParser();
            const dom = parser.parseFromString(data, "text/html");

            const baseUrl = new URL(source);
            const articleLinks: Set<string> = new Set();
            const anchorElements = dom.getElementsByTagName("a");

            for (let i = 0; i < anchorElements.length; i++) {
                let href = anchorElements[i].getAttribute("href");
                if (!href) continue;

                // Resolve relative URLs
                try {
                    href = new URL(href, baseUrl).href;
                } catch {
                    continue; // Skip malformed URLs
                }

                if (href.includes("/en/blog/")) {
                    articleLinks.add(href);
                }
            }

            const newArticleLinks = [...articleLinks].filter(href => !existingArticles.has(href));

            const articles = await Promise.all(newArticleLinks.map(async link => {
                const article = await this.fetchReadableContent(link);
                return article || null;
            }));

            return articles.filter(article => article !== null) as {
                title: string;
                content: string;
                url: string;
                author: string;
                date: string;
            }[];
        } catch (error) {
            console.error(`❌ Error processing source ${source}:`, error);
            return [];
        }
    }

    private slugify(url: string): string {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname.replace(/^www\./, "").replace(/\./g, "-");
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
        const host = "kittycrypto.ddns.net";
        const rssServer = new RssServer(host);
        await rssServer.start();
    })();
}

export default RssServer;