import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ts from "typescript";

// Matches the TypeScript AST conditional-ancestor rule in
// kittyCrypto-gg/website/scripts/check-conditional-nesting.mts.
export type Violation = Readonly<{
    file: string;
    line: number;
    kind: string;
}>;

export type SourceReport = Readonly<{
    path: string;
    lines: number;
    nesting: readonly Violation[];
}>;

export function isSource(file: string): boolean {
    return !file.endsWith(".d.ts") && (file.endsWith(".ts") || file.endsWith(".tsx"));
}

function isConditionalStatement(node: ts.Node): boolean {
    return ts.isIfStatement(node) || ts.isSwitchStatement(node);
}

function hasConditionalAncestor(node: ts.Node): boolean {
    let parent = node.parent;

    while (parent) {
        if (isConditionalStatement(parent)) return true;
        parent = parent.parent;
    }

    return false;
}

export function inspectSource(file: string, content: string): SourceReport {
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
    const violations: Violation[] = [];
    const visit = (node: ts.Node): void => {
        if (isConditionalStatement(node) && hasConditionalAncestor(node)) {
            const position = source.getLineAndCharacterOfPosition(node.getStart(source));
            violations.push({
                file,
                line: position.line + 1,
                kind: ts.SyntaxKind[node.kind]
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    const lines = content.split(/\r?\n/u).length - (content.endsWith("\n") ? 1 : 0);
    return { path: file, lines, nesting: violations };
}

async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const children = await Promise.all(entries.map(async entry => {
        const file = join(dir, entry.name);
        return entry.isDirectory() ? walk(file) : [file];
    }));
    return children.flat();
}

export async function inspectTree(directory = "src"): Promise<SourceReport[]> {
    const paths = (await walk(directory))
        .filter(isSource)
        .sort((a, b) => a.localeCompare(b));
    return Promise.all(paths.map(async file => inspectSource(
        relative(process.cwd(), file).split(sep).join("/"),
        await readFile(file, "utf8")
    )));
}

async function main(): Promise<void> {
    const reports = await inspectTree();
    const nested = reports.flatMap(r => r.nesting);
    const oversized = reports.filter(r => r.lines > 500);
    for (const report of reports) {
        console.log("[structure:file] " + report.path +
            " lines=" + report.lines + " nested=" + report.nesting.length);
    }
    for (const violation of nested) {
        console.log("[structure:nesting] " + violation.file +
            ":" + violation.line + " " + violation.kind);
    }
    for (const violation of oversized) {
        console.log("[structure:length] " + violation.path +
            ": " + violation.lines + " lines (maximum 500)");
    }
    console.log("[structure:summary] files=" + reports.length +
        " nested=" + nested.length + " oversized=" + oversized.length);
    if (!process.argv.includes("--report") && (nested.length || oversized.length)) {
        process.exitCode = 1;
    }
}

if (import.meta.main) await main();
