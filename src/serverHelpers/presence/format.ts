import type { InternalPresenceSnapshot, PublicPresenceSnapshot } from "./types";

export function isInternalPresenceSnapshot(value: unknown): value is InternalPresenceSnapshot {
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

export function formatPresenceDate(timestamp: number | null): string | null {
    if (timestamp === null) {
        return null;
    }

    const date = new Date(timestamp);
    const pad = (value: number): string => String(value).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}


export function formatPublicPresence(internalPresence: InternalPresenceSnapshot[]): PublicPresenceSnapshot {
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
