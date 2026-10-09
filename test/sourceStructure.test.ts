import { describe, expect, test } from "bun:test";
import { inspectSource, isSource } from "../scripts/check-source-structure.mts";

describe("website-parity source structure rule", () => {
    test("rejects an if nested within an if", () => {
        expect(inspectSource("x.ts", "if (a) { if (b) {} }").nesting.map(v => v.kind))
            .toEqual(["IfStatement"]);
    });
    test("rejects else-if because it is a nested AST IfStatement", () => {
        expect(inspectSource("x.ts", "if (a) {} else if (b) {}").nesting.map(v => v.kind))
            .toEqual(["IfStatement"]);
    });
    test("rejects switch under if and if under switch", () => {
        const source = "if (a) { switch (x) { default: break; } }\nswitch (x) { default: if (a) {} }";
        expect(inspectSource("x.ts", source).nesting.map(v => v.kind))
            .toEqual(["SwitchStatement", "IfStatement"]);
    });
    test("permits early returns, guard clauses and nested ternaries", () => {
        const code = "if (!ok) return;\nif (ready) return a ? (b ? 1 : 2) : 3;\nswitch (n) { case 1: return; }";
        expect(inspectSource("x.ts", code).nesting).toEqual([]);
    });
    test("tracks the 500-line threshold precisely, including terminal newlines", () => {
        expect(inspectSource("x.ts", "x;\n".repeat(500)).lines).toBe(500);
        expect(inspectSource("x.ts", "x;\n".repeat(501)).lines).toBe(501);
    });
    test("ignores declaration files and only inspects TS/TSX source", () => {
        expect(isSource("a.ts")).toBe(true);
        expect(isSource("a.tsx")).toBe(true);
        expect(isSource("a.d.ts")).toBe(false);
        expect(isSource("a.js")).toBe(false);
    });
});
