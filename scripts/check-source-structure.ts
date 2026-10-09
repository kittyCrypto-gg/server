import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, join, sep } from "node:path";
import { inspectSource } from "./source-structure-core";

const maxLines = 500;
const root = process.cwd();
const legacy = JSON.parse(await readFile(resolve(root, "scripts/source-structure-legacy.json"), "utf8")) as Record<string, string>;

async function walk(folder: string): Promise<string[]> {
    const entries = await readdir(folder, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async entry => {
        const pathname = join(folder, entry.name);
        return entry.isDirectory() ? walk(pathname) : [pathname];
    }));
    return nested.flat();
}

function isSource(file: string): boolean {
    return /\.tsx?$/.test(file) && !file.endsWith(".d.ts");
}

function gitBlobHash(content: string): string {
    const bytes = Buffer.from(content, "utf8");
    return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
}

const files = (await walk(resolve(root, "src"))).filter(isSource).sort();
let legacyFiles = 0;
let failed = 0;

for (const file of files) {
    const path = relative(root, file).split(sep).join("/");
    const source = await readFile(file, "utf8");
    const report = inspectSource(path, source);
    const tooLong = report.lines > maxLines;
    const nested = report.conditionals.length > 0;
    if (!tooLong && !nested) continue;

    const grandfatheredLength = tooLong && legacy[path] === gitBlobHash(source);
    if (grandfatheredLength) {
        ++legacyFiles;
        console.warn(`[structure] BASELINE SIZE ONLY ${path}: ${report.lines} lines`);
    }

    if (tooLong && !grandfatheredLength) {
        ++failed;
        console.error(`[structure] FAIL ${path}: ${report.lines} lines exceeds ${maxLines}`);
    }
    if (nested) {
        ++failed;
        for (const issue of report.conditionals) {
            console.error(`[structure] FAIL ${path}:${issue.line} nested ${issue.kind}`);
        }
    }
}
console.log(`[structure] scanned ${files.length} source modules; ${legacyFiles} unchanged legacy exceptions; ${failed} failing files`);
if (failed > 0) process.exitCode = 1;
