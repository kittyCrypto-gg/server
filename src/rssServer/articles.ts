import { Readability } from "@mozilla/readability";
import { DOMParser } from "@xmldom/xmldom";
import { JSDOM } from "jsdom";
import axios from "axios";
import type { aiParser } from "../aiParser";
import type { MetaDoc, ScrapedArticle } from "./types";

export async function fetchReadableContent(url: string, extractMetaDate: (dom: MetaDoc) => string | null, extractDateFromText: (text: string) => string | null, parser: aiParser) {
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
            || extractMetaDate(dom)
            || extractDateFromText(article.textContent ?? "")
            || (article.textContent ? await parser.extractDate(article.textContent) : null)
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

export async function fetchArticlesFromSource(
    source: string,
    existingArticles: Set<string>,
    fetchReadableContent: (url: string) => Promise<ScrapedArticle | null>
): Promise<ScrapedArticle[]> {
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
            const article = await fetchReadableContent(link);
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
