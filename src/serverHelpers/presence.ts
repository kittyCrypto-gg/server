import { execSync } from "node:child_process";
import fs from "fs";
type NodeErrorWithCode = Error & { code?: string };

interface SshdProcessInfo {
    processUser: string;
    pid: number;
    kind: "listener" | "privileged-monitor" | "session" | "unknown";
    sessionUser: string | null;
    terminal: string | null;
    rawCommand: string;
}

interface PresenceConfigFile {
    http?: {
        host?: unknown;
        port?: unknown;
    };
}

interface InternalPresenceSnapshot {
    userId: string;
    status: string;
    isAfk: boolean;
    activity: string;
    lastSshSeenAt: number | null;
    lastActivityAt: number | null;
    updatedAt: number;
}

interface PublicPresenceSnapshot {
    status: string;
    isAfk: boolean;
    activity: string;
    lastSshSeenAt: string | null;
    lastActivityAt: string | null;
    updatedAt: string | null;
}

function isInternalPresenceSnapshot(value: unknown): value is InternalPresenceSnapshot {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const snapshot = value as Record<string, unknown>;

    return (
        typeof snapshot.userId === "string" &&
        typeof snapshot.status === "string" &&
        typeof snapshot.isAfk === "boolean" &&
        typeof snapshot.activity === "string" &&
        (typeof snapshot.lastSshSeenAt === "number" || snapshot.lastSshSeenAt === null) &&
        (typeof snapshot.lastActivityAt === "number" || snapshot.lastActivityAt === null) &&
        typeof snapshot.updatedAt === "number"
    );
}

function formatPresenceDate(timestamp: number | null): string | null {
    if (timestamp === null) {
        return null;
    }

    const date = new Date(timestamp);
    const pad = (value: number): string => String(value).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

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

export async function getPublicPresence(): Promise<PublicPresenceSnapshot> {
    const internalPresence = await getInternalPresence();

    const kitty = internalPresence.find((entry) => entry.userId === "kitty");

    if (!kitty) {
        throw new Error("Presence entry for \"kitty\" was not found.");
    }

    kitty.status = kitty.status.toLowerCase() === "terminal" ? "Online" : kitty.status;

    return {
        status: kitty.status,
        isAfk: kitty.isAfk,
        activity: kitty.activity,
        lastSshSeenAt: formatPresenceDate(kitty.lastSshSeenAt),
        lastActivityAt: formatPresenceDate(kitty.lastActivityAt),
        updatedAt: formatPresenceDate(kitty.updatedAt)
    };
}

export function psGrepSSHD(): SshdProcessInfo[] {
    try {
        const result = execSync("ps -eo user=,pid=,args=", {
            encoding: "utf-8"
        });

        return result
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.includes("sshd:"))
            .map((line) => parseSshdProcessLine(line));
    } catch (error: unknown) {
        const code = (error as NodeErrorWithCode).code;

        if (code === "ENOENT") {
            throw new Error("ps command not found");
        }

        throw error;
    }
}

function parseSshdProcessLine(line: string): SshdProcessInfo {
    const baseMatch = line.match(/^(\S+)\s+(\d+)\s+(.+)$/);

    if (baseMatch === null) {
        return {
            processUser: "unknown",
            pid: -1,
            kind: "unknown",
            sessionUser: null,
            terminal: null,
            rawCommand: line
        };
    }

    const [, processUser, pidRaw, rawCommand] = baseMatch;
    const pid = Number.parseInt(pidRaw, 10);

    const sessionMatch = rawCommand.match(/^sshd:\s+([^@\s]+)@(\S+)\s*$/);

    if (sessionMatch !== null) {
        const [, sessionUser, terminal] = sessionMatch;

        return {
            processUser,
            pid,
            kind: "session",
            sessionUser,
            terminal,
            rawCommand
        };
    }

    const privilegedMonitorMatch = rawCommand.match(/^sshd:\s+(\S+)\s+\[priv\]\s*$/);

    if (privilegedMonitorMatch !== null) {
        const [, sessionUser] = privilegedMonitorMatch;

        return {
            processUser,
            pid,
            kind: "privileged-monitor",
            sessionUser,
            terminal: null,
            rawCommand
        };
    }

    if (rawCommand.startsWith("sshd: /usr/sbin/sshd")) {
        return {
            processUser,
            pid,
            kind: "listener",
            sessionUser: null,
            terminal: null,
            rawCommand
        };
    }

    return {
        processUser,
        pid,
        kind: "unknown",
        sessionUser: null,
        terminal: null,
        rawCommand
    };
}

