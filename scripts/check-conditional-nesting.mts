import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

type Violation = Readonly<{
    file: string;
    line: number;
    kind: string;
}>;

async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async (entry): Promise<string[]> => {
            const path = join(dir, entry.name);
            return entry.isDirectory() ? walk(path) : [path];
        })
    );

    return nested.flat();
}

function isSource(path: string): boolean {
    if (path.endsWith(".d.ts")) return false;
    return path.endsWith(".ts") || path.endsWith(".tsx");
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

function scan(file: string, content: string): Violation[] {
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        kind
    );
    const violations: Violation[] = [];

    const visit = (node: ts.Node): void => {
        if (isConditionalStatement(node) && hasConditionalAncestor(node)) {
            const position = source.getLineAndCharacterOfPosition(
                node.getStart(source)
            );

            violations.push({
                file,
                line: position.line + 1,
                kind: ts.SyntaxKind[node.kind]
            });
        }

        ts.forEachChild(node, visit);
    };

    visit(source);
    return violations;
}

const files = (await walk("src"))
    .filter(isSource)
    .sort((left, right) => left.localeCompare(right));

const violations: Violation[] = [];

for (const file of files) {
    violations.push(...scan(file, await readFile(file, "utf8")));
}

for (const violation of violations) {
    console.error(
        "[nesting] " +
        violation.file +
        ":" +
        String(violation.line) +
        " " +
        violation.kind
    );
}

if (violations.length > 0) {
    console.error(
        "[nesting] Nested conditional statements are forbidden. Found " +
        String(violations.length) +
        "."
    );
    process.exitCode = 1;
} else {
    console.log("[nesting] 0 nested conditional statements.");
}
