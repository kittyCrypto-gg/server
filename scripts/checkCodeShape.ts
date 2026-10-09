import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Immutable pre-refactor baseline is used ONLY for the 500-line module limit.
 * Nested conditional statements have no exemptions, even in unchanged files.
 */
export const BASELINE = "4e38ddaa64146124c575bd5e3aee28732b399054";
export const MAX_LINES = 500;

export type Finding = {
    file: string;
    line: number;
    rule: "nested-if" | "nested-switch";
    fingerprint: string;
};

const isControlConditional = (node: ts.Node): boolean =>
    ts.isIfStatement(node) || ts.isSwitchStatement(node);

const digest = (source: string): string =>
    createHash("sha256").update(source).digest("hex");

const statementOwner = (node: ts.Node): string => {
    const names: string[] = [];
    for (let owner = node.parent; owner; owner = owner.parent) {
        if (ts.isMethodDeclaration(owner) || ts.isFunctionDeclaration(owner) ||
            ts.isConstructorDeclaration(owner) || ts.isGetAccessorDeclaration(owner) ||
            ts.isSetAccessorDeclaration(owner)) {
            names.unshift(owner.name?.getText() ?? "constructor");
        }
        if (ts.isClassDeclaration(owner)) names.unshift(owner.name?.text ?? "<anonymous>");
        if (ts.isVariableDeclaration(owner) && owner.initializer &&
            (ts.isArrowFunction(owner.initializer) || ts.isFunctionExpression(owner.initializer))) {
            names.unshift(owner.name.getText());
        }
    }
    return names.join("/");
};

export function scanConditionals(file: string, content: string): Finding[] {
    const parsed = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
    const findings: Finding[] = [];

    const walk = (node: ts.Node, insideConditional: boolean): void => {
        const conditional = isControlConditional(node);
        if (conditional && insideConditional) {
            const printed = printer.printNode(ts.EmitHint.Unspecified, node, parsed);
            const context = statementOwner(node);
            findings.push({
                file,
                line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
                rule: ts.isIfStatement(node) ? "nested-if" : "nested-switch",
                fingerprint: digest(file + "\n" + context + "\n" + printed),
            });
        }

        // An expression-level ternary is deliberately not a control-flow
        // conditional. Nested ternaries and ternaries inside if are allowed.
        ts.forEachChild(node, child => walk(child, insideConditional || conditional));
    };

    walk(parsed, false);
    return findings;
}

export function sourceLines(content: string): number {
    if (content.length === 0) return 0;
    const lines = content.split(/\r?\n/);
    return lines.length - (content.endsWith("\n") ? 1 : 0);
}

export function sizeViolation(current: string, previous?: string): boolean {
    if (previous === current) return false;
    return sourceLines(current) > MAX_LINES;
}

const git = (...args: string[]): string => execFileSync("git", args, {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024
});

const allFiles = (directory: string): string[] => {
    const found: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) found.push(...allFiles(absolute));
        if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
            found.push(absolute.replaceAll(path.sep, "/"));
        }
    }
    return found.sort();
};

function main(): void {
    let baselinePaths: string[];
    try {
        baselinePaths = git("ls-tree", "-r", "--name-only", BASELINE, "--", "src")
            .split(/\r?\n/).filter(file => /^src\/.*\.tsx?$/.test(file) && !file.endsWith(".d.ts"));
    } catch {
        throw new Error("Missing immutable baseline " + BASELINE +
            ". Fetch repository history before running bun run check:shape.");
    }

    const baselineSources = new Map<string, string>();
    for (const file of baselinePaths) {
        baselineSources.set(file, git("show", BASELINE + ":" + file));
    }

    const errors: string[] = [];
    let totalNested = 0;
    let legacyOversized = 0;

    for (const file of allFiles("src")) {
        const current = readFileSync(file, "utf8");
        const old = baselineSources.get(file);
        if (sizeViolation(current, old)) {
            errors.push(file + ": " + sourceLines(current) + " lines; changed or new source modules must be " +
                MAX_LINES + " lines or shorter");
        }
        if (current === old && sourceLines(current) > MAX_LINES) legacyOversized++;

        const findings = scanConditionals(file, current);
        totalNested += findings.length;
        for (const finding of findings) {
            errors.push(finding.file + ":" + finding.line + ": forbidden " + finding.rule);
        }
    }

    console.log("[shape] baseline: " + BASELINE.slice(0, 12));
    console.log("[shape] nested control statements: " + totalNested + " (required: 0; no exemptions)");
    console.log("[shape] untouched oversized legacy source files: " + legacyOversized);
    console.log("[shape] changed/new source module limit: " + MAX_LINES + " lines");
    if (errors.length > 0) {
        for (const error of errors) console.error("[shape] FAIL " + error);
        process.exitCode = 1;
        return;
    }
    console.log("[shape] PASS: zero nested control statements repository-wide");
}

if (import.meta.main) main();
