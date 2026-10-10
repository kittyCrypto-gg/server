import { expect, test } from "bun:test";
import { msUntilNextSunday } from "../src/blogScheduler/timing";
import { runRepositoryCycle } from "../src/blogScheduler/runner";

test("Sunday midnight runs immediately, preserving original zero-delay decision", () => {
    expect(msUntilNextSunday(new Date(2026, 9, 11, 0, 0, 0))).toBe(0);
});

test("Sunday after midnight schedules the following Sunday", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(msUntilNextSunday(new Date(2026, 9, 11, 0, 0, 1))).toBe(week - 1000);
});

test("Saturday one second before midnight schedules one second later", () => {
    expect(msUntilNextSunday(new Date(2026, 9, 10, 23, 59, 59))).toBe(1000);
});

test("weekday scheduling preserves next-Sunday local midnight semantics", () => {
    const monday = new Date(2026, 9, 12, 9, 15, 30);
    const sunday = new Date(2026, 9, 18, 0, 0, 0);
    expect(msUntilNextSunday(monday)).toBe(sunday.getTime() - monday.getTime());
});



test("scheduler invokes README publisher after each repository, in original order", async () => {
    const events: string[] = [];
    await runRepositoryCycle(["one", "two"], {
        track: async repo => { events.push("track:" + repo); },
        publish: async () => { events.push("publish"); }
    });
    expect(events).toEqual(["track:one", "publish", "track:two", "publish"]);
});

test("tracking failure does not skip README publication or later repositories", async () => {
    const events: string[] = [];
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
        await runRepositoryCycle(["broken", "good"], {
            track: async repo => {
                events.push("track:" + repo);
                if (repo === "broken") throw new Error("tracking failed");
            },
            publish: async () => { events.push("publish"); }
        });
    } finally {
        console.error = original;
    }
    expect(events).toEqual(["track:broken", "publish", "track:good", "publish"]);
    expect(errors.map(args => args[0]))
        .toEqual(["❌ Error running tracking or blogging for broken:"]);
});

test("publisher failure is isolated per repository, even after tracking fails", async () => {
    const events: string[] = [];
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
        await runRepositoryCycle(["one", "two"], {
            track: async repo => {
                events.push("track:" + repo);
                if (repo === "one") throw new Error("tracking failed");
            },
            publish: async () => {
                events.push("publish");
                if (events.length === 2) throw new Error("publisher failed");
            }
        });
    } finally {
        console.error = original;
    }
    expect(events).toEqual(["track:one", "publish", "track:two", "publish"]);
    expect(errors.map(args => args[0])).toEqual([
        "❌ Error running tracking or blogging for one:",
        "❌ Error updating READMEs:"
    ]);
});

test("scheduler skips both workstreams when there are no repositories", async () => {
    const events: string[] = [];
    await runRepositoryCycle([], {
        track: async () => { events.push("track"); },
        publish: async () => { events.push("publish"); }
    });
    expect(events).toEqual([]);
});
