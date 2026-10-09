import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const limit = 500;

async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const children = await Promise.all(
        entries.map(async entry => {
            const location = join(dir, entry.name);
            return entry.isDirectory() ? walk(location) : [location];
        })
    );
    return children.flat();
}

function isSource(file: string): boolean {
    if (file.endsWith(".d.ts")) return false;
    return file.endsWith(".ts") || file.endsWith(".tsx");
}

const files = (await walk("src")).filter(isSource).sort();
let violations = 0;
for (const file of files) {
    const content = await readFile(file, "utf8");
    const lines = content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length;
    if (lines <= limit) continue;
    console.error("[lines] " + file + ": " + String(lines) + " lines (maximum " + String(limit) + ").");
    violations++;
}

if (violations > 0) {
    console.error("[lines] " + String(violations) + " over-limit source files.");
    process.exitCode = 1;
} else {
    console.log("[lines] All " + String(files.length) + " source files are at most " + String(limit) + " lines.");
}
