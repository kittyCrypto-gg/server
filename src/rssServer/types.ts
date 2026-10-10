export interface MetaDoc {
    getElementsByTagName(tag: string): {
        length: number;
        item(index: number): {
            getAttribute(name: string): string | null;
        } | null;
    };
}

export interface ScrapedArticle {
    title: string;
    content: string;
    url: string;
    author: string;
    date: string;
}
