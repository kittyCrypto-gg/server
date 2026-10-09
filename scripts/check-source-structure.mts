import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
    gitBlob: string;
}>;

/**
 * Only the EXACT Git blobs from main at the start of the refactor programme
 * may retain legacy violations. No wildcard files, counts or paths are exempt:
 * changing even one byte requires meeting both zero nesting and <=500 lines.
 */
const legacySourceBlobs: Readonly<Record<string, string>> = {
    "src/appDiscovery.ts": "e43ea14bb63a9819c936699069fd782f948b3cdf",
    "src/autoBlogger.ts": "9b6d9ff523265190958aa47d670f1b8cf9296c06",
    "src/githubTracker.ts": "3047ec0aca1055a019e92b250b26131baf2fbf06",
    "src/imageTransformer.ts": "561d08fb6b5d3120138607fd034b901bacf49e28",
    "src/kittyRequest.ts": "f954505adfd4dee0a39e67e9d0afcd079b41151f",
    "src/kittyServer.ts": "7a1a0d6ecffb7b282f1fddc47c8bdb6ba68a7696",
    "src/mutexStore.ts": "1591071b5e04c4e249fafe0c1b6cd8971a7eec86",
    "src/rateLimiter.ts": "ce71028816c979dace385c2a8dbccbea3345b653",
    "src/rssServer.ts": "eb29a1009173a750ffd0e3b1ae4185f32c24439f",
    "src/serverHelpers.ts": "0eb2697405a9430748df71b7be010fa9b53501a8",
    "src/trustedSitesStore.ts": "90302f44e14b13d6e070a6107546b20f89de466d",
    "src/visits.ts": "8aac7fe8cd94891e4182fcf34b6de5218e0c43d7"
};

export function isGrandfathered(report: SourceReport): boolean {
    return legacySourceBlobs[report.path] === report.gitBlob;
}

export function gitBlobHash(content: string): string {
    const buf = Buffer.from(content, "utf8");
    return createHash("sha1")
        .update(`blob ${buf.length}\0`)
        .update(buf)
        .digest("hex");
}

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
    return { path: file, lines, nesting: violations, gitBlob: gitBlobHash(content) };
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
    const regressions = reports.filter(r =>
        (r.nesting.length > 0 || r.lines > 500) && !isGrandfathered(r)
    );
    for (const report of reports) {
        console.log("[structure:file] " + report.path +
            " lines=" + report.lines + " nested=" + report.nesting.length +
            " baseline=" + isGrandfathered(report));
    }
    for (const violation of nested) {
        console.log("[structure:nesting] " + violation.file +
            ":" + violation.line + " " + violation.kind);
    }
    for (const violation of oversized) {
        console.log("[structure:length] " + violation.path +
            ": " + violation.lines + " lines (maximum 500)");
    }
    for (const report of regressions) {
        console.error("[structure:FAIL] " + report.path +
            ": " + report.nesting.length + " nested conditional(s), " +
            report.lines + " lines; changed/new files must have zero nesting and <=500 lines.");
    }
    console.log("[structure:summary] files=" + reports.length +
        " nested=" + nested.length + " oversized=" + oversized.length +
        " grandfathered=" + reports.filter(isGrandfathered).length +
        " violations=" + regressions.length);
    if (!process.argv.includes("--report") && regressions.length > 0) {
        process.exitCode = 1;
    }
}

if (import.meta.main) await main();
