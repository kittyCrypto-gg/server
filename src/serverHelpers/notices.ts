import fs from "fs";
import path from "path";
import { isRecord } from "./buildManifest";
type NodeErrorWithCode = Error & { code?: string };

type NtcFile = unknown[] | Record<string, unknown>;

function resDataPath(...segs: readonly string[]): string {
    const dataRoot = path.resolve(process.cwd(), "data");
    const filePath = path.resolve(dataRoot, ...segs);
    const rel = path.relative(dataRoot, filePath);

    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error("Unsafe data path.");
    }

    return filePath;
}

function getNtcsPath(): string {
    return resDataPath("notices.json");
}

export async function readNtcs(): Promise<NtcFile | null> {
    const targetPath = getNtcsPath();

    try {
        const raw = await fs.promises.readFile(targetPath, "utf8");

        if (!raw.trim()) {
            return null;
        }

        const parsed = JSON.parse(raw) as unknown;

        if (Array.isArray(parsed)) {
            return parsed;
        }

        if (isRecord(parsed)) {
            return parsed;
        }

        return null;
    } catch (error: unknown) {
        const code = (error as NodeErrorWithCode).code;

        if (code === "ENOENT") {
            return null;
        }

        throw error;
    }
}
