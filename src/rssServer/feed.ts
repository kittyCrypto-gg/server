import Parser from "rss-parser";
import { DOMParser } from "@xmldom/xmldom";
import { Feed } from "feed";
import fs from "fs-extra";
import { RSS_CACHE_DIR } from "./config";
import type { ScrapedArticle } from "./types";

export interface FeedContext {
    slugify(url: string): string;
    fetchAndCacheRSS(source: string, cacheFile: string): Promise<boolean>;
    fetchArticlesFromSource(source: string, existingArticles: Set<string>): Promise<ScrapedArticle[]>;
}

export async function fetchAndCacheRSS(source: string, cacheFile: string): Promise<boolean> {
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

export async function generateRSS(ctx: FeedContext, source: string): Promise<Feed> {
    const feed = new Feed({
        title: `RSS for ${source}`,
        description: `RSS feed dynamically generated from ${source}`,
        link: source,
        id: source,
        copyright: `All Rights Reserved, ${new Date().getFullYear()}`,
        author: { name: "RSS Generator" },
    });

    const slug = ctx.slugify(source);
    const sourceCacheDir = `${RSS_CACHE_DIR}/${slug}`;
    await fs.ensureDir(sourceCacheDir);
    const cacheFile = `${sourceCacheDir}/feed.xml`;

    // Try fetching the RSS feed first
    const success = await ctx.fetchAndCacheRSS(source, cacheFile);

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

    const articles = await ctx.fetchArticlesFromSource(source, new Set(existingArticles.keys()));

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
