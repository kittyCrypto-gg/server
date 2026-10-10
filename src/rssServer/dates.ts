import dates from "compromise-dates";
import nlp from "compromise";
import type { MetaDoc } from "./types";

const nlpWithDates = nlp.extend(dates);
export function extractMetaDate(dom: MetaDoc): string | null {
    const metaTags = [
        "meta[property='article:published_time']",
        "meta[name='date']",
        "meta[name='publish-date']",
        "meta[name='pubdate']",
        "meta[property='og:article:published_time']",
    ];

    for (const tag of metaTags) {
        const elements = dom.getElementsByTagName("meta");
        for (let i = 0; i < elements.length; i++) {
            const element = elements.item(i);
            if (!element) continue;
            const nameAttr = element.getAttribute("name") || element.getAttribute("property");
            const contentAttr = element.getAttribute("content");

            if (nameAttr === tag.replace(/meta\[name='|meta\[property='|\']/g, "")
                && contentAttr && !isNaN(Date.parse(contentAttr))) return contentAttr;
        }
    }

    return null;
}

export function extractDateFromText(text: string): string | null {
    const doc = nlpWithDates(text);
    const foundDates = doc.dates().json();
    if (!foundDates.length) return null;

    const parsedDate = new Date(foundDates[0].start);
    if (isNaN(parsedDate.getTime())) return null;

    return parsedDate.toISOString();
}
