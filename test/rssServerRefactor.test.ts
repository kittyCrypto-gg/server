import { expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Parser from "rss-parser";
import { DOMParser } from "@xmldom/xmldom";
import { slugify } from "../src/rssServer/sources";
import { extractMetaDate, extractDateFromText } from "../src/rssServer/dates";
import { fetchAndCacheRSS } from "../src/rssServer/feed";

test("feed paths retain hostname-based slug rules", () => {
    expect(slugify("https://www.example.org/en/blog")).toBe("example-org");
    expect(slugify("https://blog.example.co.uk/")).toBe("blog-example-co-uk");
});

test("the same published-time meta tags remain recognised", () => {
    const doc = new DOMParser().parseFromString(
        "<html><head><meta property='article:published_time' content='2026-10-09T12:00:00Z'></head><body></body></html>",
        "text/html"
    );
    expect(extractMetaDate(doc)).toBe("2026-10-09T12:00:00Z");
    const none = new DOMParser().parseFromString("<html><head></head><body></body></html>", "text/html");
    expect(extractMetaDate(none)).toBeNull();
});

test("non-date article bodies preserve the null date fallback", () => {
    expect(extractDateFromText("abcdefghijklmnop")).toBeNull();
});

test("valid RSS sources preserve generated cache XML fields", async () => {
    const folder = await mkdtemp(join(tmpdir(), "rss-refactor-"));
    const cacheFile = join(folder, "feed.xml");
    const spy = spyOn(Parser.prototype, "parseURL").mockImplementation(async () => ({
        title: "Feed title",
        description: "Feed description",
        items: [{
            title: "Example title", link: "https://example.org/post", contentSnippet: "Summary",
            pubDate: "Fri, 09 Oct 2026 12:00:00 GMT", creator: "Author"
        }]
    }) as Awaited<ReturnType<Parser["parseURL"]>>);
    try {
        expect(await fetchAndCacheRSS("https://example.org/rss", cacheFile)).toBe(true);
        const xml = await readFile(cacheFile, "utf8");
        expect(xml).toContain("<title>Feed title</title>");
        expect(xml).toContain("<![CDATA[Example title]]>");
        expect(xml).toContain("<![CDATA[Summary]]>");
        expect(xml).toContain("<![CDATA[Author]]>");
    } finally {
        spy.mockRestore();
        await rm(folder, { recursive: true, force: true });
    }
});
