import fs from "fs";
import type { PresenceConfigFile, InternalPresenceSnapshot } from "./types";
import { isInternalPresenceSnapshot } from "./format";

async function getPresenceBaseUrl(): Promise<string> {
    const configPath = process.env.PRESENCE_CONFIG_PATH;

    if (typeof configPath !== "string" || configPath.trim().length === 0) {
        throw new Error("PRESENCE_CONFIG_PATH is not set.");
    }

    const rawConfig = await fs.promises.readFile(configPath, "utf8");
    const parsedConfig = JSON.parse(rawConfig) as PresenceConfigFile;

    const host = parsedConfig.http?.host;
    const port = parsedConfig.http?.port;

    if (typeof host !== "string" || host.trim().length === 0) {
        throw new Error("Presence config http.host is missing or invalid.");
    }

    if (typeof port !== "number" || Number.isInteger(port) === false || port < 1 || port > 65535) {
        throw new Error("Presence config http.port is missing or invalid.");
    }

    return `http://${host}:${port}`;
}

export async function getInternalPresence(): Promise<InternalPresenceSnapshot[]> {
    const baseUrl = await getPresenceBaseUrl();
    const response = await fetch(`${baseUrl}/internal/presence`);

    if (!response.ok) {
        throw new Error(`Presence backend returned ${response.status}.`);
    }

    const payload = await response.json() as unknown;

    if (Array.isArray(payload) === false) {
        throw new Error("Presence backend did not return an array.");
    }

    return payload.filter((entry): entry is InternalPresenceSnapshot => {
        return isInternalPresenceSnapshot(entry);
    });
}

