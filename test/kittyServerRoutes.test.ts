import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const routeModules = [{"file":"sessions.ts","reg":"registerSessionRoutes"},{"file":"chatStream.ts","reg":"registerChatStreamRoutes"},{"file":"comments.ts","reg":"registerCommentRoutes"},{"file":"content.ts","reg":"registerContentRoutes"},{"file":"allowedSources.ts","reg":"registerAllowedSourceRoutes"},{"file":"chatbot.ts","reg":"registerChatbotRoutes"},{"file":"media.ts","reg":"registerMediaRoutes"},{"file":"trustedSites.ts","reg":"registerTrustedSiteRoutes"},{"file":"visits.ts","reg":"registerVisitRoutes"},{"file":"siteStatus.ts","reg":"registerSiteStatusRoutes"}];
const expected = ["get: \"/session-token\",","post: \"/session-token/reregister\",","get: \"/get-ip\", cors({ origin: \"*\" }),","get: \"/get-ip/sha256\", cors({ origin: \"*\" }),","get: \"/chat/stream\",","get: \"/comments/load\",","get: '/robots.txt',","get: \"/stories.json\",","get: /^\\/stories\\/(.+)$/,","get: [\"/sitemap.xml\", \"/website/sitemap.xml\"],","get: \"/allowedSources.json\",","all: \"/chatbot/register\",","post: \"/chatbot/authenticate\",","get: \"/img\",","get: \"/render\",","post: \"/verify/register/:site\",","get: \"/verify/:site/kittycrow.key\",","post: \"/verify/:site\",","post: \"/visits/log\",","get: \"/visits/stats\",","post: \"/visits/log/:site\",","get: \"/visits/stats/:site\",","get: \"/presence\",","get: \"/website/manifest\",","post: \"/website/manifest/update\",","get: \"/notices\",","get: \"/status\","];
const read = (file: string): string => readFileSync(path.resolve(import.meta.dir, "..", file), "utf8");

describe("kittyServer route contracts", () => {
    test("retains all 27 route registrations in their original order", () => {
        const main = read("src/kittyServer.ts");
        const calls = [...main.matchAll(/^(register[A-Za-z]+Routes)\(routeContext\);/gm)].map(m => m[1]);
        expect(calls).toEqual(routeModules.map(r => r.reg));
        const actual = routeModules.flatMap(r => {
            const source = read("src/kittyServer/routes/" + r.file);
            return [...source.matchAll(/^server\.app\.(get|post|all)\((.+)$/gm)].map(m => m[1] + ": " + m[2]);
        });
        expect(actual).toEqual(expected);
        expect(actual).toHaveLength(27);
    });

    test("retains middleware placement and synchronous registration before start", () => {
        const main = read("src/kittyServer.ts");
        expect(main).not.toMatch(/server\.app\.(get|post|all)\(/);
        expect(main.indexOf("server.start();")).toBeGreaterThan(main.indexOf("registerSiteStatusRoutes(routeContext);"));
        expect(main.indexOf("chat.onNewMessage = async")).toBeGreaterThan(main.indexOf("registerCommentRoutes(routeContext);"));
        expect(main.indexOf("chat.onNewMessage = async")).toBeLessThan(main.indexOf("registerContentRoutes(routeContext);"));
    });

    test("all route registrars remain synchronous typed functions", () => {
        for (const item of routeModules) {
            const file = "src/kittyServer/routes/" + item.file;
            const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            const registration = source.statements.find(stmt => ts.isFunctionDeclaration(stmt) && stmt.name?.text === item.reg);
            expect(registration && ts.isFunctionDeclaration(registration)).toBeTruthy();
            if (registration && ts.isFunctionDeclaration(registration)) {
                expect(registration.modifiers?.some(mod => mod.kind === ts.SyntaxKind.AsyncKeyword)).toBeFalsy();
            }
        }
    });
});
