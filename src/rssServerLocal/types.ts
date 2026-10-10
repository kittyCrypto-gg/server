export interface LocalPost {
    title: string;
    date: string;
    slug: string;
    postId: string;
    summary?: string;
    author?: string;
    tags?: string[];
    content: string;
    image?: string;
}

export type LocalPostDraft = Omit<LocalPost, "postId">;

