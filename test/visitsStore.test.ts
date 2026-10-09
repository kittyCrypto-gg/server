import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import ts from "typescript"
import { ExtVisitsStore } from "../src/extVisits"
import { VisitsStore, visitsProtoCodec, visitsProtoSchema, visitsProtoConversionOptions } from "../src/visits"
import * as originalSymbols from "../src/visits"
import { visitsProtoCodec as moduleCodec, visitsProtoSchema as moduleSchema } from "../src/visits/schema"
import type { VisitsModel } from "../src/visits"

const temporary: string[] = []
const tmp = async (): Promise<string> => {
    const folder = await mkdtemp(path.join(tmpdir(), "visits-refactor-"))
    temporary.push(folder)
    return folder
}
afterEach(async () => {
    await Promise.all(temporary.splice(0).map(folder => rm(folder, { recursive: true, force: true })))
})

class CompatibleVisitsSubclass extends VisitsStore {
    protected override normalisePage(page: string): string {
        const normal = super.normalisePage(page)
        return normal === "/legacy" ? "/modern" : normal
    }
    public async inspectProtectedHooks(): Promise<VisitsModel> {
        const current = await super.readNormalisedModel()
        const page = super.normalisePage("/index.html")
        const ip = super.normaliseIp("::ffff:203.0.113.10")
        expect(page).toBe("/")
        expect(ip).toBe("203.0.113.10")
        expect(super.getOverallVisits(current)).toBeGreaterThanOrEqual(0)
        expect(super.createEmptyBucket()).toEqual({ visits: 0, ips: {} })
        return current
    }
}

describe("VisitsStore compatibility and persistence", () => {
    test("original class, exported codec/schema and source names remain compatible", async () => {
        expect(typeof VisitsStore).toBe("function")
        expect(Object.keys(originalSymbols).sort()).toEqual([
            "VisitsStore", "visitsProtoCodec", "visitsProtoConversionOptions", "visitsProtoSchema"
        ].sort())
        expect(visitsProtoCodec).toBe(moduleCodec)
        expect(visitsProtoSchema).toBe(moduleSchema)
        expect(visitsProtoConversionOptions.longs).toBe(Number)
        const filename = path.resolve(import.meta.dir, "../src/visits.ts")
        const tree = ts.createSourceFile(filename, await readFile(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
        const exported = tree.statements.filter(s => ts.isExportDeclaration(s) || (ts.isClassDeclaration(s) && s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)))
        const named = exported.flatMap(s => ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause)
            ? s.exportClause.elements.map(e => e.name.text) : ts.isClassDeclaration(s) ? [s.name?.text] : []).filter(Boolean)
        expect(named).toHaveLength(20)
    })

    test("counts visits and unique visitors across pages while capping timestamps", async () => {
        const folder = await tmp()
        const filePath = path.join(folder, "visits.pb")
        const store = new VisitsStore({ filePath, maxTimestampsPerIp: 2 })
        const a = new Date("2026-10-09T11:00:00.000Z")
        const b = new Date("2026-10-09T11:01:00.000Z")
        const c = new Date("2026-10-09T11:02:00.000Z")
        const first = await store.logVisit("::ffff:203.0.113.10", "/index.html", a)
        expect(first).toMatchObject({ visits: 1, uniqueVisitors: 1, ip: "203.0.113.10", page: { page: "/", visits: 1 } })
        await store.logVisit("203.0.113.10", "/", b)
        const third = await store.logVisit("203.0.113.10", "/other?ref=x", c)
        expect(third).toMatchObject({
            visits: 3, uniqueVisitors: 1, ipVisitCount: 3, lastVisitAt: c.getTime(),
            page: { page: "/other?ref=x", visits: 1, uniqueVisitors: 1, ipVisitCount: 1 }
        })
        const stats = await store.getStats()
        expect(stats).toMatchObject({ visits: 3, uniqueVisitors: 1, updatedAt: c.getTime() })
        expect(await store.getPageStats("/index.html")).toMatchObject({ page: "/", visits: 2, uniqueVisitors: 1 })
        const pb = visitsProtoCodec.decode(await readFile(filePath))
        expect(pb.pages["/"].ips["203.0.113.10"]).toMatchObject({
            count: 2, timestamps: [a.getTime(), b.getTime()]
        })
        await store.logVisit("203.0.113.10", "/", new Date(c.getTime() + 1000))
        const updated = visitsProtoCodec.decode(await readFile(filePath))
        expect(updated.pages["/"].ips["203.0.113.10"].timestamps).toEqual([b.getTime(), c.getTime() + 1000])
        expect((await stat(filePath)).mode & 0o777).toBe(0o600)
        const reloaded = new VisitsStore({ filePath, maxTimestampsPerIp: 2 })
        expect((await reloaded.getStats()).visits).toBe(4)
    })

    test("migrates historical JSON into protobuf without destroying the JSON file", async () => {
        const folder = await tmp(), jsonFile = path.join(folder, "visits.json")
        const at = "2025-01-02T03:04:05.000Z"
        const legacy = {
            visits: 2,
            ips: { "203.0.113.4": { count: 2, timestamps: [at] } },
            pages: { "/index.html": { visits: 2, ips: { "::ffff:203.0.113.4": { count: 2, timestamps: [at] } } } },
            updatedAt: at
        }
        await writeFile(jsonFile, JSON.stringify(legacy))
        const store = new VisitsStore({ filePath: jsonFile })
        expect(await store.getStats()).toEqual({
            visits: 2, uniqueVisitors: 1, updatedAt: Date.parse(at)
        })
        const migrated = visitsProtoCodec.decode(await readFile(path.join(folder, "visits.pb")))
        expect(migrated.pages["/"].ips["203.0.113.4"]).toEqual({
            count: 2, timestamps: [Date.parse(at)]
        })
        expect(JSON.parse(await readFile(jsonFile, "utf8"))).toEqual(legacy)
        await store.logVisit("203.0.113.4", "/", new Date("2026-01-01T00:00:00Z"))
        expect((await store.getStats()).visits).toBe(3)
    })

    test("existing protobuf data takes precedence over legacy JSON", async () => {
        const folder = await tmp(), pbFile = path.join(folder, "visits.pb")
        const timestamp = Date.parse("2025-10-01T00:00:00Z")
        const state: VisitsModel = {
            pages: { "/old": { visits: 5, ips: { "198.51.100.1": { count: 5, timestamps: [timestamp] } } } },
            updatedAt: timestamp
        }
        const raw = visitsProtoCodec.encode(state)
        await writeFile(pbFile, raw)
        await writeFile(path.join(folder, "visits.json"), JSON.stringify({
            pages: { "/wrong": { visits: 1, ips: { "198.51.100.2": { count: 1, timestamps: [] } } } },
            updatedAt: "2024-01-01"
        }))
        const store = new VisitsStore({ filePath: pbFile })
        expect(await store.getStats()).toMatchObject({ visits: 5, uniqueVisitors: 1 })
        expect((await store.getPageStats("/old")).visits).toBe(5)
        expect((await store.getPageStats("/wrong")).visits).toBe(0)
        expect(await readFile(pbFile)).toEqual(raw)
    })

    test("original protected hooks remain virtual and work through subclass overrides", async () => {
        const folder = await tmp()
        const store = new CompatibleVisitsSubclass({ filePath: path.join(folder, "hook.pb") })
        await store.inspectProtectedHooks()
        await store.logVisit("203.0.113.20", "/legacy", new Date("2026-01-01"))
        expect((await store.getPageStats("/modern")).visits).toBe(1)
        expect((await store.getPageStats("/legacy")).page).toBe("/modern")
    })

    test("ExtVisitsStore continues to isolate visits by origin with the original inheritance", async () => {
        const folder = await tmp()
        const store = new ExtVisitsStore({ rootDirPath: folder })
        const stamp = new Date("2026-01-02T12:34:56Z")
        const one = await store.logVisit("https://example.org", "203.0.113.1", "/", stamp)
        const two = await store.logVisit("https://different.org", "203.0.113.1", "/", stamp)
        expect(one.visits).toBe(1)
        expect(two.visits).toBe(1)
        expect((await store.getStats("https://example.org")).visits).toBe(1)
        expect((await store.getStats("https://different.org")).visits).toBe(1)
        expect((await store.getStats()).visits).toBe(0)
        expect(visitsProtoCodec.decode(await readFile(path.join(folder, "example.org", "visits.pb"))).pages["/"].visits).toBe(1)
        expect(visitsProtoCodec.decode(await readFile(path.join(folder, "different.org", "visits.pb"))).pages["/"].visits).toBe(1)
    })

    test("invalid pages and IPs retain the original validation messages", async () => {
        const folder = await tmp()
        const store = new VisitsStore({ filePath: path.join(folder, "invalid.pb") })
        await expect(store.logVisit(" ", "/")).rejects.toThrow("VisitsStore.logVisit requires a non-empty ip string")
        await expect(store.logVisit("203.0.113.1", " ")).rejects.toThrow("VisitsStore.logVisit requires a non-empty page string")
        await expect(store.getPageStats(" ")).rejects.toThrow("VisitsStore.getPageStats requires a non-empty page string")
    })
})
