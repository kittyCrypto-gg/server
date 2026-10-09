import type { Request } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
type NodeErrorWithCode = Error & { code?: string };

export interface BuildManifest {
    version: 1;
    files: Record<string, string>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
    if (!isRecord(value)) {
        return false;
    }

    return Object.values(value).every((entry) => typeof entry === "string");
}

export function isBuildManifest(value: unknown): value is BuildManifest {
    if (!isRecord(value)) {
        return false;
    }

    if (value.version !== 1) {
        return false;
    }

    return isStringRecord(value.files);
}

export function normalisManifest(value: unknown): BuildManifest | null {
    if (!isBuildManifest(value)) {
        return null;
    }

    return {
        version: 1,
        files: { ...value.files }
    };
}

export function getBuildManifestPath(): string {
    const configuredPath = typeof process.env.BUILD_MANIFEST_PATH === "string"
        ? process.env.BUILD_MANIFEST_PATH.trim()
        : "";

    if (configuredPath) {
        return configuredPath;
    }

    return path.resolve(process.cwd(), "data", "buildManifest.json");
}

export function readBuildKeyHeader(req: Request): string {
    const rawHeader = req.headers["x-build-key"];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    return typeof headerValue === "string" ? headerValue.trim() : "";
}

export function hasValidBuildKey(req: Request): boolean {
    const expectedKey = typeof process.env.BUILD_KEY === "string"
        ? process.env.BUILD_KEY.trim()
        : "";

    const receivedKey = readBuildKeyHeader(req);

    if (!expectedKey || !receivedKey) {
        return false;
    }

    const expectedBuffer = Buffer.from(expectedKey, "utf8");
    const receivedBuffer = Buffer.from(receivedKey, "utf8");

    if (expectedBuffer.length !== receivedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function readBuildManifest(): Promise<BuildManifest | null> {
    const targetPath = getBuildManifestPath();

    try {
        const raw = await fs.promises.readFile(targetPath, "utf8");

        if (!raw.trim()) {
            return null;
        }

        return normalisManifest(JSON.parse(raw) as unknown);
    } catch (error: unknown) {
        const code = (error as NodeErrorWithCode).code;

        if (code === "ENOENT") {
            return null;
        }

        throw error;
    }
}

export async function writeBuildManifest(manifest: BuildManifest): Promise<void> {
    const targetPath = getBuildManifestPath();
    const normalised = normalisManifest(manifest);

    if (normalised === null) {
        throw new Error("Cannot write invalid build manifest.");
    }

    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

    const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

    await fs.promises.writeFile(
        tmpPath,
        `${JSON.stringify(normalised, null, 2)}\n`,
        "utf8"
    );

    try {
        await fs.promises.rename(tmpPath, targetPath);
    } catch (error: unknown) {
        await fs.promises.unlink(tmpPath).catch(() => { });
        throw error;
    }
}

export async function updateManifest(value: unknown): Promise<BuildManifest> {
    const manifest = normalisManifest(value);

    if (manifest === null) {
        throw new Error("Invalid build manifest payload.");
    }

    await writeBuildManifest(manifest);
    return manifest;
}
