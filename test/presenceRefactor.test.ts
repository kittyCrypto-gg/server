import { expect, test } from "bun:test";
import { formatPresenceDate, formatPublicPresence, isInternalPresenceSnapshot } from "../src/serverHelpers/presence/format";
import { parseSshdProcessLine } from "../src/serverHelpers/presence/ssh";
import type { InternalPresenceSnapshot } from "../src/serverHelpers/presence/types";

const now = new Date(2026, 9, 10, 14, 5, 6).getTime();
const presence = (): InternalPresenceSnapshot => ({
    userId: "kitty",
    status: "terminal",
    isAfk: false,
    activity: "Editing files",
    lastSshSeenAt: now,
    lastActivityAt: null,
    updatedAt: now
});

test("presence payload guard retains field requirements and array filtering rules", () => {
    expect(isInternalPresenceSnapshot(presence())).toBe(true);
    expect(isInternalPresenceSnapshot({ ...presence(), userId: 2 })).toBe(false);
    expect(isInternalPresenceSnapshot({ ...presence(), isAfk: "false" })).toBe(false);
    expect(isInternalPresenceSnapshot({ ...presence(), lastActivityAt: undefined })).toBe(false);
    expect(isInternalPresenceSnapshot(null)).toBe(false);
});

test("public presence transforms terminal to Online and retains local-date formatting", () => {
    const kitty = presence();
    const result = formatPublicPresence([{ ...presence(), userId: "someone-else" }, kitty]);
    expect(result).toEqual({
        status: "Online",
        isAfk: false,
        activity: "Editing files",
        lastSshSeenAt: "2026-10-10 14:05:06",
        lastActivityAt: null,
        updatedAt: "2026-10-10 14:05:06"
    });
    expect(kitty.status).toBe("Online");
    expect(formatPresenceDate(null)).toBeNull();
    expect(formatPresenceDate(now)).toBe("2026-10-10 14:05:06");
});

test("public presence retains missing-Kitty error and unchanged non-terminal statuses", () => {
    expect(() => formatPublicPresence([])).toThrow('Presence entry for "kitty" was not found.');
    const kitty = { ...presence(), status: "Away" };
    expect(formatPublicPresence([kitty]).status).toBe("Away");
    expect(kitty.status).toBe("Away");
});

test("SSH parser distinguishes sessions, privilege monitors, listeners and malformed lines", () => {
    expect(parseSshdProcessLine("kitty 150 sshd: kitty@pts/0")).toMatchObject({
        processUser: "kitty", pid: 150, kind: "session",
        sessionUser: "kitty", terminal: "pts/0"
    });
    expect(parseSshdProcessLine("root 120 sshd: kitty [priv]")).toMatchObject({
        processUser: "root", pid: 120, kind: "privileged-monitor",
        sessionUser: "kitty", terminal: null
    });
    expect(parseSshdProcessLine("root 100 sshd: /usr/sbin/sshd -D")).toMatchObject({
        processUser: "root", pid: 100, kind: "listener"
    });
    expect(parseSshdProcessLine("nobody 200 sshd: unknown")).toMatchObject({
        processUser: "nobody", pid: 200, kind: "unknown"
    });
    expect(parseSshdProcessLine("malformed")).toMatchObject({
        processUser: "unknown", pid: -1, kind: "unknown",
        sessionUser: null, terminal: null
    });
});
