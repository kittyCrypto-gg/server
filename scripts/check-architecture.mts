import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import ts from "typescript";

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

function posix(path: string): string {
    return path.split(sep).join("/");
}

function resolveImport(from: string, specifier: string, known: Set<string>): string | null {
    if (!specifier.startsWith(".")) return null;

    const base = resolve(dirname(from), specifier);
    const candidates = extname(base)
        ? [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx")]
        : [
            base + ".ts",
            base + ".tsx",
            join(base, "index.ts"),
            join(base, "index.tsx")
        ];

    for (const candidate of candidates) {
        const key = posix(relative(process.cwd(), normalize(candidate)));
        if (known.has(key)) return key;
    }

    return null;
}

function feature(path: string): string | null {
    const parts = posix(path).split("/");
    if (parts[0] !== "src") return null;
    if (parts.length < 3) return null;
    return parts[1] ?? null;
}

function isFacade(path: string): boolean {
    return /\/index\.tsx?$/.test(posix(path));
}

const files = (await walk("src"))
    .filter(isSource)
    .map(posix)
    .sort((left, right) => left.localeCompare(right));

const known = new Set(files);
const graph = new Map<string, string[]>();
const boundaryFailures: string[] = [];

for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    const source = ts.createSourceFile(
        file,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const imports: string[] = [];

    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;

        const isTypeOnlyImport =
            ts.isImportDeclaration(statement) &&
            statement.importClause?.isTypeOnly === true;

        const isTypeOnlyExport =
            ts.isExportDeclaration(statement) &&
            statement.isTypeOnly === true;

        if (isTypeOnlyImport || isTypeOnlyExport) continue;
        if (!statement.moduleSpecifier) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

        const target = resolveImport(file, statement.moduleSpecifier.text, known);
        if (!target) continue;
        imports.push(target);

        const fromFeature = feature(file);
        const toFeature = feature(target);
        if (!fromFeature || !toFeature) continue;
        if (fromFeature === toFeature) continue;
        if (isFacade(target)) continue;

        boundaryFailures.push(
            file + " imports private cross-feature module " + target
        );
    }

    graph.set(file, [...new Set(imports)]);
}

const visiting = new Set<string>();
const visited = new Set<string>();
const cycles: string[][] = [];

function visit(node: string, trail: string[]): void {
    if (visiting.has(node)) {
        const start = trail.indexOf(node);
        cycles.push([...trail.slice(start), node]);
        return;
    }

    if (visited.has(node)) return;

    visiting.add(node);
    const nextTrail = [...trail, node];

    for (const next of graph.get(node) ?? []) {
        visit(next, nextTrail);
    }

    visiting.delete(node);
    visited.add(node);
}

for (const file of files) visit(file, []);

for (const cycle of cycles) {
    console.error("[architecture] Import cycle: " + cycle.join(" -> "));
}

for (const failure of boundaryFailures) {
    console.error("[architecture] " + failure);
}

if (cycles.length > 0 || boundaryFailures.length > 0) {
    process.exitCode = 1;
} else {
    console.log(
        "[architecture] " +
        String(files.length) +
        " source modules are acyclic and feature boundaries are clean."
    );
}
