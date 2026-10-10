import { expect, test } from "bun:test";
import { createHash } from "crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAuthorLine, readString, readIsoDate, readTags, makePostId } from "../src/rssServerLocal/metadata";
import { loadLocalPosts } from "../src/rssServerLocal/posts";
import { addLocalPostXmlMetadata, escapeXml, generateLocalRSS } from "../src/rssServerLocal/feed";
import type { LocalPost, LocalPostDraft } from "../src/rssServerLocal/types";

const ctx = { readAuthorLine, readString, readIsoDate, readTags,
    makePostId: (post: LocalPostDraft) => makePostId(post, "kittycrypto") };

test("front matter helpers preserve author, dates, tags and blank values", () => {
    expect(readAuthorLine('---\nauthor: "Kitty A&B"\ntitle: Test\n---\nBody')).toBe("Kitty A&B");
    expect(readAuthorLine("---\ntitle: Test\n---")).toBeNull();
    expect(readString("  value  ")).toBe("value");
    expect(readString("   ")).toBeNull();
    expect(readString(45)).toBeNull();
    expect(readIsoDate("2026-10-09")).toBe("2026-10-09T00:00:00.000Z");
    expect(readIsoDate("bad-date")).toBeNull();
    expect(readTags(["  news ", 1, "posts", ""])).toEqual(["news", "posts"]);
    expect(readTags([])).toBeUndefined();
});

test("post identifiers retain original SHA256 seed and separator", () => {
    const post = { title: "A title", date: "2026-10-09T12:00:00.000Z",
        slug: "a-post", author: "Kitty", content: "Post body" };
    const seed = ["kittycrypto", "a-post", post.date, post.title, "Kitty"].join("\u001F");
    expect(makePostId(post, "kittycrypto")).toBe(
        createHash("sha256").update(seed, "utf8").digest("hex"));
    expect(makePostId({ ...post, author: undefined }, "kittycrypto"))
        .toBe(makePostId(post, "kittycrypto"));
});

test("loader parses Markdown, skips missing titles and orders by descending date", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rss-local-"));
    try {
        await writeFile(join(dir, "older.md"),
            "---\ntitle: Older\ndate: '2026-10-07T12:00:00Z'\nsummary: 'An old post'\ntags: [blog, notes]\n---\n Hello world  ");
        await writeFile(join(dir, "newer.md"),
            '---\ntitle: Newer\ndate: "2026-10-09T12:00:00Z"\nauthor: "A&B"\nslug: custom-post\n---\nNew content');
        await writeFile(join(dir, "invalid.md"), "---\ndate: 2026-10-10\n---\nNo title");
        await writeFile(join(dir, "ignored.txt"), "not Markdown");
        const items = await loadLocalPosts(dir, ctx);
        expect(items.map(p => p.slug)).toEqual(["custom-post", "older"]);
        expect(items[0]?.author).toBe("A&B");
        expect(items[0]?.content).toBe("New content");
        expect(items[1]?.author).toBe("Kitty");
        expect(items[1]?.tags).toEqual(["blog", "notes"]);
        expect(items[1]?.summary).toBe("An old post");
        expect(items[0]?.postId).toBe(makePostId(items[0]!, "kittycrypto"));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("feed preserves link, stable post ID and description", () => {
    const items: LocalPost[] = [{ title: "First post", date: "2026-10-09T12:00:00.000Z",
        slug: "first", postId: "abc123", author: "Kitty", content: "Hello", summary: "Summary" }];
    const xml = generateLocalRSS(items, { slug: "kittycrypto", title: "Kitty’s Blog",
        description: "Personal posts from Kitty’s blog" }).rss2();
    expect(xml).toContain("https://rss.kittycrypto.gg/rss/kittycrypto#abc123");
    expect(xml).toContain("First post");
    expect(xml).toContain("Summary");
});

test("RSS custom tags escape XML and remain aligned to item order", () => {
    const items = [
        { title: "First", postId: "a&1", author: "A&B <Test>" },
        { title: "Second", postId: "b2", author: "Kitty" }
    ] as LocalPost[];
    const xml = addLocalPostXmlMetadata("<channel><item></item><item></item></channel>", items, escapeXml);
    expect(xml).toContain("<author>A&amp;B &lt;Test&gt;</author>");
    expect(xml).toContain("<postId>a&amp;1</postId>");
    expect(xml.indexOf("<postId>a&amp;1</postId>")).toBeLessThan(xml.indexOf("<postId>b2</postId>"));
    expect(escapeXml("A&<>\"'")).toBe("A&amp;&lt;&gt;&quot;&apos;");
    expect(addLocalPostXmlMetadata("<item></item>", [], escapeXml)).toBe("<item></item>");
});
