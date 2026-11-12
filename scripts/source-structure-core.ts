import ts from "typescript";

export type ConditionalViolation = Readonly<{ line: number; kind: string }>;
export type StructureReport = Readonly<{ lines: number; conditionals: ConditionalViolation[] }>;

function isConditionalStatement(node: ts.Node): boolean {
    return ts.isIfStatement(node) || ts.isSwitchStatement(node);
}

/** Mirrors the website AST rule: a conditional under another if/switch is forbidden. */
export function inspectSource(file: string, content: string): StructureReport {
    const source = ts.createSourceFile(
        file, content, ts.ScriptTarget.Latest, true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const conditionals: ConditionalViolation[] = [];

    const visit = (node: ts.Node, insideConditional: boolean): void => {
        const conditional = isConditionalStatement(node);
        if (conditional && insideConditional) {
            conditionals.push({
                line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                kind: ts.SyntaxKind[node.kind],
            });
        }
        ts.forEachChild(node, child => visit(child, insideConditional || conditional));
    };
    visit(source, false);

    return {
        lines: content.split(/\r\n|\n|\r/).length,
        conditionals,
    };
}
