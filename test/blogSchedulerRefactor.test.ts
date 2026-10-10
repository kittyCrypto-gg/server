import { expect, test } from "bun:test";
import { msUntilNextSunday } from "../src/blogScheduler/timing";

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
