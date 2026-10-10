import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { RSS_CACHE_DIR } from "../src/rssServer/config";
import { generateRSS, type FeedContext } from "../src/rssServer/feed";
import { slugify } from "../src/rssServer/sources";
import type { ScrapedArticle } from "../src/rssServer/types";

const original: ScrapedArticle = {
    title: "Cached article",
    url: "https://example.org/en/blog/cached",
    author: "Cached author",
    content: "This must not be duplicated.",
    date: "2026-10-08T12:00:00Z"
};

const latest: ScrapedArticle = {
    title: "New article",
    url: "https://example.org/en/blog/new",
    author: "New author",
    content: "Newly fetched content",
    date: "2026-10-09T12:00:00Z"
};

async function withUniqueCache(
    callback: (source: string, cacheFile: string) => Promise<void>
): Promise<void> {
    const source = "https://rss-parity-" + randomUUID().replace(/-/g, "") + ".example/en/blog";
    const folder = join(RSS_CACHE_DIR, slugify(source));
    const cacheFile = join(folder, "feed.xml");
    await mkdir(folder, { recursive: true });
    try {
        await callback(source, cacheFile);
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}

function links(xml: string): string[] {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    return Array.from(doc.getElementsByTagName("item")).map(item =>
        item.getElementsByTagName("link")[0]?.textContent?.trim() || ""
    );
}

test("fallback RSS rehydrates historical cache and avoids duplicate scraped links", async () => {
    await withUniqueCache(async (source, cacheFile) => {
        await writeFile(cacheFile, [
            '<?xml version="1.0" encoding="utf-8"?>',
            "<rss version='2.0'><channel><item>",
            "<title>Cached article</title>",
            "<link>https://example.org/en/blog/cached</link>",
            "<description>Previously cached</description>",
            "<pubDate>Thu, 08 Oct 2026 12:00:00 GMT</pubDate>",
            "</item></channel></rss>"
        ].join(""), "utf8");

        let knownUrls: string[] = [];
        const ctx: FeedContext = {
            slugify,
            fetchAndCacheRSS: async () => false,
            fetchArticlesFromSource: async (_source, existing) => {
                knownUrls = [...existing];
                return [original, latest];
            }
        };

        const generated = (await generateRSS(ctx, source)).rss2();
        expect(knownUrls).toEqual([original.url]);
        expect(links(generated)).toEqual([original.url, latest.url]);
        expect(generated).toContain("Previously cached");
        expect(generated).toContain("Newly fetched content...");
        expect(await readFile(cacheFile, "utf8")).toBe(generated);
    });
});

test("fallback RSS creates a cache when no feed or saved articles exist", async () => {
    await withUniqueCache(async (source, cacheFile) => {
        let passedUrls: string[] = ["not called"];
        const ctx: FeedContext = {
            slugify,
            fetchAndCacheRSS: async () => false,
            fetchArticlesFromSource: async (_source, existing) => {
                passedUrls = [...existing];
                return [latest];
            }
        };

        const generated = (await generateRSS(ctx, source)).rss2();
        expect(passedUrls).toEqual([]);
        expect(links(generated)).toEqual([latest.url]);
        expect(await readFile(cacheFile, "utf8")).toBe(generated);
    });
});

test("native RSS success keeps its fetched cache and skips manual scraping", async () => {
    await withUniqueCache(async (source, cacheFile) => {
        const nativeXml = '<?xml version="1.0"?><rss version="2.0"><channel><item><link>https://example.org/native</link></item></channel></rss>';
        let fetched = 0;
        let scraped = 0;
        const ctx: FeedContext = {
            slugify,
            fetchAndCacheRSS: async (requested, file) => {
                expect(requested).toBe(source);
                expect(file).toBe(cacheFile);
                fetched++;
                await writeFile(file, nativeXml, "utf8");
                return true;
            },
            fetchArticlesFromSource: async () => {
                scraped++;
                return [latest];
            }
        };

        await generateRSS(ctx, source);
        expect(fetched).toBe(1);
        expect(scraped).toBe(0);
        expect(await readFile(cacheFile, "utf8")).toBe(nativeXml);
        // Known existing gap, not asserted here: the returned Feed omits the
        // native items even though they were cached. Fix in a separate PR.
    });
});
