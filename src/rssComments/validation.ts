import type { RssCommentData } from "./types";

export function isValidURL(value: string): boolean {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}


    export function isValidRssComment(data: unknown): data is RssCommentData {
        if (typeof data !== "object" || data === null) {
            return false;
        }

        const comment = data as RssCommentData;

        return (
            typeof comment.slug === "string" &&
            typeof comment.nick === "string" &&
            typeof comment.msg === "string" &&
            typeof comment.ip === "string" &&
            typeof comment.sessionToken === "string" &&
            typeof comment.timestamp === "string" &&
            typeof comment.id === "string" &&
            (comment.website === undefined || typeof comment.website === "string") &&
            (comment.location === undefined || typeof comment.location === "string")
        );
    }
    export function safeDecode(value: string): string {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }

