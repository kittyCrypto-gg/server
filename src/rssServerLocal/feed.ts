import { Feed } from "feed";
import type { LocalPost } from "./types";
export interface LocalFeedConfig { slug: string; title: string; description: string; }
    export function escapeXml(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    export function generateLocalRSS(posts: readonly LocalPost[], config: LocalFeedConfig): Feed {
        const baseUrl = `https://rss.kittycrypto.gg`;

        const feed = new Feed({
            title: config.title,
            description: config.description,
            id: `${baseUrl}/rss/${config.slug}`,
            link: `${baseUrl}/rss/${config.slug}`,
            copyright: `All Rights Reserved, ${(new Date()).getFullYear()}`,
            author: { name: "Kitty" },
            updated: new Date(posts[0]?.date || Date.now()),
            feedLinks: {
                rss: `${baseUrl}/rss/${config.slug}`,
                atom: `${baseUrl}/rss/${config.slug}.atom`
            },
            generator: "KittyCrypto RSS Server"
        });

        for (const post of posts) {
            feed.addItem({
                title: post.title,
                id: `${baseUrl}/rss/${config.slug}#${post.postId}`,
                link: `${baseUrl}/rss/${config.slug}#${post.postId}`,
                date: new Date(post.date),
                description: post.summary,
                author: post.author ? [{ name: post.author }] : [{ name: "Kitty" }],
                content: post.content,
                image: post.image
            });
        }

        return feed;
    }

export function addLocalPostXmlMetadata(xml: string, posts: readonly LocalPost[], encode: (text: string) => string): string {
    let postIx = 0;
    return xml.replace(/<\/item>/g, (match: string): string => {
        const post = posts[postIx];
        postIx += 1;
        if (!post) return match;
        return [
            `<author>${encode(post.author || "Kitty")}</author>`,
            `<postId>${encode(post.postId)}</postId>`,
            match
        ].join("\n");
    });
}
