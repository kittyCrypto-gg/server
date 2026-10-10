import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TrSites } from "../src/trustedSites"
import { TrSitesStore } from "../src/trustedSitesStore"
import type { FetchLike } from "../src/trustedSites/types"

const NOW = 1_800_000_000_000

async function withStore(run: (store: TrSitesStore) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "trusted-site-logic-"))
    try {
        await run(new TrSitesStore({ filePath: join(dir, "trusted.pb") }))
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

function response(body: string, status = 200, contentLength: string | null = null) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => name === "content-length" ? contentLength : null },
        text: async () => body
    }
}

test("site keys, input guards and missing registration base URL remain unchanged", async () => {
    await withStore(async store => {
        const logic = new TrSites({ store })
        expect(logic.mkSiteKey("https://www.EXAMPLE.org:8443")).toBe("example-org-8443")
        expect(logic.siteToOrig("EXAMPLE.org")).toBe("https://example.org")
        await expect(logic.reg({ site: "example.org", now: NOW })).rejects.toThrow(
            "Server base URL is required to build the key-file download URL."
        )
        expect(await store.listChals(NOW)).toEqual([])
    })
})

test("registration preserves key file, canonical site, URL and expiry", async () => {
    await withStore(async store => {
        const logic = new TrSites({ store, srvBaseUrl: "https://kittycrow.dev/" })
        const reg = await logic.reg({ site: "HTTPS%3A%2F%2FEXAMPLE.ORG", requesterKey: "owner", now: NOW })
        expect(reg.origin).toBe("https://example.org")
        expect(reg.siteKey).toBe("example-org")
        expect(reg.keyFileName).toBe("kittycrow.key")
        expect(reg.keyFileDownloadUrl).toBe("https://kittycrow.dev/verify/example.org/kittycrow.key")
        expect(reg.keyFile).toEqual({
            fileName: "kittycrow.key",
            contentType: "application/json; charset=utf-8",
            body: reg.keyFileText,
            keyFileSha256: reg.keyFileSha256
        })
        expect(logic.key({ site: "example.org", now: NOW + 1 })).toEqual(reg.keyFile)
        expect(await logic.isTrst("https://example.org")).toBe(false)
    })
})

test("network verification preserves requester binding and removes published key only on success", async () => {
    await withStore(async store => {
        let body = ""
        const calls: string[] = []
        const fake: FetchLike = async (url, init) => {
            calls.push(url)
            expect(init?.signal).toBeInstanceOf(AbortSignal)
            return response(body)
        }
        const logic = new TrSites({ store, srvBaseUrl: "https://kittycrow.dev", fetchFn: fake })
        const reg = await logic.reg({ site: "https://example.org", requesterKey: "owner", now: NOW })
        body = reg.keyFileText

        const rejected = await logic.chk({ site: "example.org", requesterKey: "wrong", now: NOW + 2 })
        expect(rejected.verified).toBe(false)
        expect(logic.key({ site: "example.org", now: NOW + 3 }).body).toBe(body)

        const verified = await logic.chk({ site: "example.org", requesterKey: "owner", now: NOW + 4 })
        expect(verified.verified).toBe(true)
        expect(verified.fetchedKeyFileSha256).toBe(reg.keyFileSha256)
        expect(verified.verificationUrl).toBe("https://example.org/.well-known/kittycrow.key")
        expect(calls).toEqual([verified.verificationUrl, verified.verificationUrl])
        expect(await logic.isTrst("https://example.org")).toBe(true)
        expect(() => logic.key({ site: "example.org", now: NOW + 5 })).toThrow("not found or has expired")
    })
})

test("verification rejects HTTP errors and oversized response headers or body", async () => {
    await withStore(async store => {
        const url = "https://example.org"
        const badStatus = new TrSites({ store, fetchFn: async () => response("", 404) })
        await expect(badStatus.chk({ site: url, now: NOW })).rejects.toThrow("HTTP 404")

        let bodyRead = false
        const overHeader = new TrSites({
            store,
            maxKeyFileBytes: 10,
            fetchFn: async () => ({
                ...response("", 200, "11"),
                text: async () => { bodyRead = true; return "" }
            })
        })
        await expect(overHeader.chk({ site: url, now: NOW })).rejects.toThrow("too large")
        expect(bodyRead).toBe(false)

        const overBody = new TrSites({
            store,
            maxKeyFileBytes: 4,
            fetchFn: async () => response("💙💙", 200, null)
        })
        await expect(overBody.chk({ site: url, now: NOW })).rejects.toThrow("too large")
    })
})

test("published key expires at exact TTL boundary and malformed origins remain invalid", async () => {
    await withStore(async store => {
        const logic = new TrSites({ store, srvBaseUrl: "https://kittycrow.dev" })
        const reg = await logic.reg({ site: "example.org", now: NOW })
        expect(logic.key({ site: "example.org", now: reg.expiresAt - 1 }).body).toBe(reg.keyFileText)
        expect(() => logic.key({ site: "example.org", now: reg.expiresAt })).toThrow("not found or has expired")
        expect(() => logic.siteToOrig("")).toThrow("Site parameter is required")
        expect(() => logic.siteToOrig("http://example.org")).toThrow()
        expect(() => logic.siteToOrig("https://example.org/path")).toThrow()
        expect(() => logic.readSiteParam("   ")).toThrow("Route requires a site parameter")
        expect(logic.readSiteParam(" example.org ")).toBe(" example.org ")
    })
})

test("public subclass hooks remain dynamically dispatched through extracted workflows", async () => {
    await withStore(async store => {
        const seen: string[] = []
        class CustomSites extends TrSites {
            public override siteToOrig(site: string): string {
                seen.push("siteToOrig")
                return super.siteToOrig(site)
            }

            public override mkSiteKey(origin: string): string {
                seen.push("mkSiteKey")
                return super.mkSiteKey(origin)
            }
        }
        const logic = new CustomSites({ store, srvBaseUrl: "https://kittycrow.dev" })
        await logic.reg({ site: "example.org", now: NOW })
        logic.key({ site: "example.org", now: NOW + 1 })
        expect(seen).toEqual(["siteToOrig", "mkSiteKey", "siteToOrig"])
    })
})
