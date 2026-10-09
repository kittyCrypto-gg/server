import fetch from "node-fetch";
import type * as types from "../types";

export async function getChapters(storyPath: string): Promise<{ chapters: number[]; urls: string[] }> {
    const chapters: number[] = [];
    const urls: string[] = [];
    const BASE = "https://kittycrypto.gg";

    const remotePath = storyPath.replace(/^\.\//, "");

    try {
        const url0 = `${BASE}/${remotePath}/chapt0.xml`;
        const res0 = await fetch(url0, { method: "HEAD" });
        if (res0.ok) {
            chapters.push(0);
            urls.push(url0);
        }
    } catch { }

    let i = 1;

    while (true) {
        const url = `${BASE}/${remotePath}/chapt${i}.xml`;

        try {
            const res = await fetch(url, { method: "HEAD" });
            if (!res.ok) break;

            chapters.push(i);
            urls.push(url);
            i++;
        } catch {
            console.log(`Discovered ${chapters.length} chapters for ${storyPath}.`);
            break;
        }
    }

    console.log(`Discovered ${chapters.length} chapters for ${storyPath}.`);
    return { chapters, urls };
}

export async function getHtmlPagesFromGithub(repoOwner: string, repoName: string, dir: string = ""): Promise<string[]> {
    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${dir}`;

    const headers: Record<string, string> = { "User-Agent": "kitty-sitemap-bot" };

    if (process.env.GITHUB_TOKEN) {
        headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(apiUrl, { headers });

    if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const items = await res.json() as types.GithubContentItem[];
    let urls: string[] = [];

    for (const item of items) {
        if (item.type === "file" && item.name.endsWith(".html")) {
            const pagePath = dir ? `${dir}/${item.name}` : item.name;
            urls.push(`https://kittycrypto.gg/${pagePath.replace(/^index\.html$/, "")}`);
            continue;
        }

        if (item.type === "dir") {
            urls.push(...await getHtmlPagesFromGithub(repoOwner, repoName, item.path));
        }
    }

    return urls;
}
