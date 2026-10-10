import fs from "fs-extra";
import { SOURCES_FILE } from "./config";

export async function loadSources(): Promise<string[]> {
    try {
        if (await fs.pathExists(SOURCES_FILE)) {
            const data = await fs.readFile(SOURCES_FILE, "utf-8");
            return JSON.parse(data);
        }
        throw new Error("Sources file not found");
    } catch (error) {
        console.error("Error reading sources:", error);
        return [];
    }
}

export function slugify(url: string): string {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname.replace(/^www\./, "").replace(/\./g, "-");
}
