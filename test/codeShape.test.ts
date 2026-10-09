import { describe, expect, test } from "bun:test";
import { MAX_LINES, scanConditionals, sizeViolation, sourceLines } from "../scripts/checkCodeShape";

const scan = (content: string) => scanConditionals("src/example.ts", content);

describe("code-shape CI rules", () => {
    test("rejects if inside if, even with an early return", () => {
        expect(scan("if (a) {\n if (b) return;\n}")).toHaveLength(1);
    });
    test("rejects if in else and else-if chains", () => {
        expect(scan("if (a) {} else { if (b) {} }")).toHaveLength(1);
        expect(scan("if (a) {} else if (b) {}")).toHaveLength(1);
    });
    test("rejects if in a conditional callback", () => {
        expect(scan("if (ready) { queueMicrotask(() => { if (ok) run(); }); }")).toHaveLength(1);
    });
    test("rejects nested switch/if statements in either direction", () => {
        expect(scan("switch (n) { case 1: if (ready) run(); break; }")).toHaveLength(1);
        expect(scan("if (ready) { switch (n) { case 1: run(); } }")).toHaveLength(1);
    });
    test("allows ternaries, even when nested or inside if", () => {
        expect(scan("if (ready) { const x = foo ? bar ? a : b : c; }")).toHaveLength(0);
    });
    test("allows flat guard clauses and consecutive conditions", () => {
        expect(scan("if (!ready) return;\nif (!valid) return;\nif (needed) run();")).toHaveLength(0);
    });
    test("ignores comments and whitespace for baseline fingerprints", () => {
        const a = scan("if (a) {\n if (b) act();\n}");
        const b = scan("if (a) { // comment\n\n if (b) { act(); }\n}");
        expect(a.map(x => x.fingerprint)).toEqual(b.map(x => x.fingerprint));
    });
    test("requires new/modified modules to stay within 500 lines", () => {
        expect(MAX_LINES).toBe(500);
        const old = "x\n".repeat(501);
        expect(sourceLines(old)).toBe(501);
        expect(sizeViolation(old, old)).toBe(false);
        expect(sizeViolation(old, undefined)).toBe(true);
        expect(sizeViolation(old + "y\n", old)).toBe(true);
        expect(sizeViolation("x\n".repeat(500), old)).toBe(false);
    });
});
