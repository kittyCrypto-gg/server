import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const expected = [
  "BuildManifest",
  "OpenChatStreamOptions",
  "buildRequestBaseUrl",
  "exploreStories",
  "genSiteMap",
  "generateSessionToken",
  "getBuildManifestPath",
  "getChapters",
  "getClientIp",
  "getHtmlPagesFromGithub",
  "getInternalPresence",
  "getPublicPresence",
  "hasValidBuildKey",
  "isBuildManifest",
  "isSseResponseWritable",
  "matchOrig",
  "normVisitOrig",
  "normVstSiteParam",
  "normalisManifest",
  "normaliseImgFormat",
  "notifyClients",
  "openChatStream",
  "originAllowsDecrypted",
  "parseImgQuery",
  "parsePositiveInt",
  "psGrepSSHD",
  "readBuildKeyHeader",
  "readBuildManifest",
  "readNtcs",
  "readTrimmedQueryString",
  "readVisitSource",
  "registerAppDiscoveryEndpoint",
  "registerPage",
  "removeSseClient",
  "resolveStoryPath",
  "sendImgError",
  "sendImgResult",
  "trackChatChanges",
  "updateManifest",
  "updateUsersFile",
  "writeBuildManifest",
  "writeSseComment",
  "writeSseJson"
];

describe("serverHelpers compatibility", () => {
    test("keeps every original named export at the original module path", () => {
        const sourcePath = path.resolve(import.meta.dir, "../src/serverHelpers.ts");
        const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const actual: string[] = [];
        for (const statement of source.statements) {
            if (!ts.isExportDeclaration(statement)) continue;
            if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
            for (const element of statement.exportClause.elements) actual.push(element.name.text);
        }
        expect(actual.sort()).toEqual(expected);
    });

    test("retains the historical registration template location", () => {
        const registration = readFileSync(path.resolve(import.meta.dir, "../src/serverHelpers/registration.ts"), "utf8");
        expect(registration).toContain('path.resolve(import.meta.dir, "../../ui/register.html")');
    });
});

describe("extracted helper modules", () => {
    test("contain no nested if statements", () => {
        const dir = path.resolve(import.meta.dir, "../src/serverHelpers");
        const violations: string[] = [];
        for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
            const sourcePath = path.join(dir, file);
            const source = ts.createSourceFile(
                sourcePath,
                readFileSync(sourcePath, "utf8"),
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TS
            );
            const walk = (node: ts.Node, insideIf: boolean): void => {
                if (ts.isIfStatement(node) && insideIf) {
                    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
                    violations.push(file + ":" + line);
                }
                ts.forEachChild(node, (child) => walk(child, insideIf || ts.isIfStatement(node)));
            };
            walk(source, false);
        }
        expect(violations).toEqual([]);
    });

    test("preserves registration rendering at its original template location", async () => {
        const { registerPage } = await import("../src/serverHelpers/registration.ts");
        const page = registerPage("<invalid>", "<token>");
        expect(page).toContain("&lt;invalid&gt;");
        expect(page).toContain("&lt;token&gt;");
    });

    test("preserves session client IP forwarding precedence", async () => {
        const { getClientIp } = await import("../src/serverHelpers/requestIdentity.ts");
        const req = {
            headers: {
                "cf-connecting-ip": "203.0.113.10",
                "x-forwarded-for": "198.51.100.20, 198.51.100.21"
            },
            socket: { remoteAddress: "::ffff:192.0.2.30" }
        };
        expect(getClientIp(req as never)).toBe("203.0.113.10");
        delete (req.headers as Record<string, unknown>)["cf-connecting-ip"];
        expect(getClientIp(req as never)).toBe("198.51.100.20");
        delete (req.headers as Record<string, unknown>)["x-forwarded-for"];
        expect(getClientIp(req as never)).toBe("192.0.2.30");
    });

    test("preserves strict visit origin validation", async () => {
        const { normVisitOrig } = await import("../src/serverHelpers/visitOrigins.ts");
        expect(normVisitOrig("Example.COM")).toBe("https://example.com");
        expect(() => normVisitOrig("http://example.com")).toThrow();
        expect(() => normVisitOrig("https://example.com/private")).toThrow();
        expect(() => normVisitOrig("https://user:pass@example.com")).toThrow();
    });
});
