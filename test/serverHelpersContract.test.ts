import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
