import type { Response } from "express";
import fetch from "node-fetch";
import { getHtmlPagesFromGithub } from "./githubContent";

export async function genSiteMap(
    includedPages: ReadonlySet<string> = new Set<string>(),
    res: Response
): Promise<void> {
    try {
        const githubPages = await getHtmlPagesFromGithub("kittyCrypto-gg", "website");

        const shouldFilterGitHubPages = includedPages.size > 0;

        const filteredGithubPages = shouldFilterGitHubPages
            ? githubPages.filter((pageUrl) => {
                const pageUrlObject = new URL(pageUrl);
                const relativePath = decodeURIComponent(pageUrlObject.pathname.replace(/^\/+/, ""));
                const fileName = relativePath.split("/").pop() ?? "";

                return includedPages.has(relativePath) || includedPages.has(fileName);
            })
            : githubPages;

        const storiesRes = await fetch("https://srv.kittycrypto.gg/stories.json");
        const stories = await storiesRes.json() as Record<string, string[]>;

        const storyChapterLinks = Object.entries(stories).flatMap(([storyPath, chapters]) => {
            return chapters.map((chapter) => {
                return `https://nojs.kittycrypto.gg/reader.html?story=${encodeURIComponent(storyPath)}&chapter=${encodeURIComponent(chapter)}`;
            });
        });

        const allUrls = [...filteredGithubPages, ...storyChapterLinks]
            .map((url) => url.replace(/\/+$/, ""))
            .filter((value, index, entries) => entries.indexOf(value) === index);

        function xmlEscape(value: string): string {
            return value
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&apos;");
        }

        const locs = allUrls
            .map((url) => `<url><loc>${xmlEscape(url)}</loc></url>`)
            .join("\n");

        const xml =
            `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
            `${locs}\n` +
            `</urlset>`;

        res.set("Content-Type", "application/xml");
        res.send(xml);
        console.log(`✅ Sitemap generated with ${allUrls.length} URLs.`);
    } catch (error) {
        console.error("❌ Error generating sitemap:", error);
        res.status(500).send("Failed to generate sitemap.");
    }
}
