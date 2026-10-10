export type NodeErrorWithCode = Error & { code?: string };

export interface SshdProcessInfo {
    processUser: string;
    pid: number;
    kind: "listener" | "privileged-monitor" | "session" | "unknown";
    sessionUser: string | null;
    terminal: string | null;
    rawCommand: string;
}

export interface PresenceConfigFile {
    http?: {
        host?: unknown;
        port?: unknown;
    };
}

export interface InternalPresenceSnapshot {
    userId: string;
    status: string;
    isAfk: boolean;
    activity: string;
    lastSshSeenAt: number | null;
    lastActivityAt: number | null;
    updatedAt: number;
}

export interface PublicPresenceSnapshot {
    status: string;
    isAfk: boolean;
    activity: string;
    lastSshSeenAt: string | null;
    lastActivityAt: string | null;
    updatedAt: string | null;
}

