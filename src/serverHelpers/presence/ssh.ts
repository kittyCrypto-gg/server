import { execSync } from "node:child_process";
import type { NodeErrorWithCode, SshdProcessInfo } from "./types";

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

export function parseSshdProcessLine(line: string): SshdProcessInfo {
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

