import { createHash } from "crypto";
import type { LocalPostDraft } from "./types";
export function readAuthorLine(raw: string): string | null {
    const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    const body = frontMatter?.[1] ?? "";

    const line = body
        .split(/\r?\n/)
        .find((entry) => /^\s*author\s*:/.test(entry));

    if (!line) return null;

    const rawAuthor = line
        .replace(/^\s*author\s*:\s*/, "")
        .trim();

    const author = rawAuthor
        .replace(/^["']/, "")
        .replace(/["']$/, "")
        .trim();

    return author.length > 0 ? author : null;
}

export function readString(value: unknown): string | null {
    if (typeof value !== "string") return null;

    const clean = value.trim();
    return clean.length > 0 ? clean : null;
}

export function readIsoDate(value: unknown): string | null {
    const date =
        value instanceof Date
            ? value
            : typeof value === "string" || typeof value === "number"
                ? new Date(value)
                : null;

    if (!date) return null;
    if (Number.isNaN(date.getTime())) return null;

    return date.toISOString();
}

export function readTags(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const tags = value
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

    return tags.length > 0 ? tags : undefined;
}

export function makePostId(post: LocalPostDraft, localFeedSlug: string): string {
    const seed = [
        localFeedSlug,
        post.slug,
        post.date,
        post.title,
        post.author || "Kitty"
    ].join("\u001F");

    return createHash("sha256")
        .update(seed, "utf8")
        .digest("hex");
}

