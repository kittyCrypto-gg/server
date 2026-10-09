import type * as types from "../types";
import path from "path";
import fs from "fs";

export async function resolveStoryPath(rest: string, storiesRoot: string): Promise<string | null> {
    let cleaned: string;

    try {
        cleaned = decodeURIComponent(rest);
    } catch {
        return null;
    }

    cleaned = cleaned
        .replace(/^\/+/, "")
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/");

    if (!cleaned) return null;

    const segments = cleaned.split("/");

    for (const seg of segments) {
        if (!seg) return null;
        if (seg === "." || seg === "..") return null;
        if (!/^[a-zA-Z0-9._ + -]+$/.test(seg)) return null;
    }

    const filePath = path.resolve(storiesRoot, ...segments);
    const rel = path.relative(storiesRoot, filePath);

    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        return null;
    }

    try {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile()) return null;

        await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
        return null;
    }

    return filePath;
}

export async function exploreStories(storiesRoot: string): Promise<types.StoriesIndex> {
    const out: types.StoriesIndex = {};

    const isStoryDirName = (name: string): boolean => {
        return /^[a-zA-Z0-9 _-]+$/.test(name);
    };

    const isChapterXml = (name: string): boolean => {
        return /^chapt\d+\.xml$/i.test(name);
    };

    const entries = await fs.promises.readdir(storiesRoot, { withFileTypes: true });
    const storyDirs = entries.filter((entry) => entry.isDirectory() && isStoryDirName(entry.name));

    for (const dir of storyDirs) {
        const storyPath = path.join(storiesRoot, dir.name);
        const files = await fs.promises.readdir(storyPath, { withFileTypes: true });

        const chapters = files
            .filter((file) => file.isFile() && isChapterXml(file.name))
            .map((file) => file.name)
            .sort((a, b) => {
                const aMatch = a.match(/^chapt(\d+)\.xml$/i);
                const bMatch = b.match(/^chapt(\d+)\.xml$/i);

                const na = Number(aMatch?.[1] ?? "0");
                const nb = Number(bMatch?.[1] ?? "0");

                return na - nb;
            });

        out[dir.name] = chapters;
    }

    return out;
}
