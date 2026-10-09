import { describe, expect, test } from "bun:test";
import { inspectSource } from "../scripts/source-structure-core";

describe("source structure AST enforcement", () => {
    test("rejects if in if and switch in if regardless of block nesting", () => {
        const report = inspectSource("sample.ts", `
if (outer) {
    if (inner) ok();
    switch (value) { case 1: break; }
}
`);
        expect(report.conditionals.map(x => x.kind)).toEqual(["IfStatement", "SwitchStatement"]);
        expect(report.conditionals.map(x => x.line)).toEqual([3, 4]);
    });

    test("rejects else-if as nested syntax, matching the website rule", () => {
        const report = inspectSource("sample.ts", "if (a) run(); else if (b) run();");
        expect(report.conditionals).toEqual([{ line: 1, kind: "IfStatement" }]);
    });

    test("allows guard clauses, independent conditions, and nested ternaries", () => {
        const report = inspectSource("sample.ts", `
function run(a: boolean, b: boolean) {
  if (a) return;
  if (b) return;
  return a ? (b ? 1 : 2) : 3;
}
`);
        expect(report.conditionals).toEqual([]);
    });

    test("rejects nested if inside switch while allowing separate switch statements", () => {
        const report = inspectSource("sample.ts", "switch(x) { case 1: if (x) run(); }\nswitch(y) {}");
        expect(report.conditionals).toEqual([{ line: 1, kind: "IfStatement" }]);
    });

    test("tracks the 500-line limit without off-by-one errors", () => {
        expect(inspectSource("short.ts", Array(500).fill("const a = 1;").join("\n")).lines).toBe(500);
        expect(inspectSource("long.ts", Array(501).fill("const a = 1;").join("\n")).lines).toBe(501);
    });

    test("detects nesting in TSX source", () => {
        const report = inspectSource("component.tsx", "const X = () => { if (a) { if (b) return <div/>; } };");
        expect(report.conditionals).toHaveLength(1);
    });
});
