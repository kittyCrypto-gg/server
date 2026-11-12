import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import ts from "typescript"
import { TrSitesStore, type TrSitesOpts } from "../src/trustedSitesStore"
import { pbCodec } from "../src/trustedSitesStore/schema"

const dirs: string[] = []
const now = 1_800_000_000_000
const create = async (options: TrSitesOpts = {}) => {
    const dir = await mkdtemp(path.join(tmpdir(), "trusted-sites-"))
    dirs.push(dir)
    const filePath = path.join(dir, "trusted.pb")
    return { filePath, store: new TrSitesStore({ filePath, ...options }) }
}
afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})
const sha = (input: string): string => createHash("sha256").update(input, "utf8").digest("hex")

describe("trusted site verification compatibility", () => {
    test("preserves all eight named and type exports at the original file", async () => {
        const file = path.resolve(import.meta.dir, "../src/trustedSitesStore.ts")
        const root = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
        const names: string[] = []
        for (const node of root.statements) {
            if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
                names.push(...node.exportClause.elements.map(el => el.name.text))
            }
            if (ts.isClassDeclaration(node) && node.name && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
                names.push(node.name.text)
            }
        }
        expect(names.sort()).toEqual([
            "TrSiteRec", "PendSiteChal", "TrSitesOpts", "MkChalArgs", "MkChalRes",
            "VrfChalArgs", "VrfChalRes", "TrSitesStore"
        ].sort())
        for (const name of [
            "mkChal", "vrfChal", "isTrst", "getSite", "listSites", "listChals",
            "revSite", "delChal", "normOrig", "mkVrfUrl", "mkKeyFile", "hashKeyFile"
        ]) {
            expect(typeof (TrSitesStore.prototype as unknown as Record<string, unknown>)[name]).toBe("function")
        }
    })

    test("normalises origins without weakening HTTPS, path or credential restrictions", async () => {
        const { store } = await create()
        expect(store.normOrig(" HTTPS://EXAMPLE.ORG:443 ")).toBe("https://example.org")
        expect(store.normOrig("https://Example.ORG:8443")).toBe("https://example.org:8443")
        for (const origin of [
            "", "http://example.org", "ftp://example.org",
            "https://a:b@example.org", "https://example.org/p",
            "https://example.org/?q=x", "https://example.org/#part"
        ]) {
            expect(() => store.normOrig(origin)).toThrow()
        }
        const { store: allowed } = await create({ allowHttp: true })
        expect(allowed.normOrig("http://example.org")).toBe("http://example.org")
        expect(() => allowed.normOrig("ftp://example.org")).toThrow()
    })

    test("key file format, verification URL, SHA256 and token requirements remain identical", async () => {
        const { store } = await create({ verificationPath: "/.well-known/custom.key" })
        const key = store.mkKeyFile("https://example.org", "secret-token")
        expect(key).toBe(JSON.stringify({
            service: "kittycrow-visits",
            origin: "https://example.org",
            challengeToken: "secret-token"
        }, null, 4) + "\n")
        expect(store.mkVrfUrl("https://example.org")).toBe("https://example.org/.well-known/custom.key")
        expect(store.hashKeyFile(key)).toBe(sha(key))
        expect(() => store.mkKeyFile("https://example.org", "  ")).toThrow("Challenge token is required.")
    })

    test("a valid challenge verifies once, persists as protobuf and survives reloading", async () => {
        const { store, filePath } = await create()
        const challenge = await store.mkChal({ origin: "https://Example.org", requesterKey: " owner ", now })
        expect(challenge.origin).toBe("https://example.org")
        expect(challenge.expiresAt).toBe(now + 30 * 60_000)
        expect(challenge.challengeToken).toMatch(/^[a-zA-Z0-9_-]{43}$/)
        expect(challenge.challengeTokenHash).toBe(sha(challenge.challengeToken))
        expect(challenge.keyFileSha256).toBe(sha(challenge.keyFileText))
        expect(challenge.verificationUrl).toBe("https://example.org/.well-known/kittycrow.key")
        const pending = pbCodec.decode(await readFile(filePath))
        expect(pending.pendingChallenges["https://example.org"].requesterKey).toBe("owner")
        expect(pending.pendingChallenges["https://example.org"].challengeTokenHash).toBe(challenge.challengeTokenHash)
        expect(JSON.stringify(pending)).not.toContain(challenge.challengeToken)
        const result = await store.vrfChal({
            origin: "https://example.org", requesterKey: "owner",
            keyFileText: challenge.keyFileText, now: now + 100
        })
        expect(result).toEqual({
            verified: true,
            origin: "https://example.org",
            trustedSite: {
                origin: "https://example.org",
                verifiedAt: now + 100,
                verificationPath: "/.well-known/kittycrow.key",
                lastChallengeAt: now
            }
        })
        expect(await store.isTrst("https://example.org")).toBe(true)
        expect(await store.listChals(now + 100)).toEqual([])
        const after = pbCodec.decode(await readFile(filePath))
        expect(Object.keys(after.pendingChallenges)).toEqual([])
        expect(after.trustedSites["https://example.org"]).toEqual(result.trustedSite)
        expect((await stat(filePath)).mode & 0o777).toBe(0o600)
        const restarted = new TrSitesStore({ filePath })
        expect(await restarted.getSite("https://example.org")).toEqual(result.trustedSite)
    })

    test("requester mismatch and checksum mismatch cannot consume an otherwise valid challenge", async () => {
        const { store } = await create()
        const challenge = await store.mkChal({ origin: "https://example.org", requesterKey: "one", now })
        const wrongRequester = await store.vrfChal({ origin: challenge.origin, keyFileText: challenge.keyFileText, requesterKey: "two", now: now + 1 })
        expect(wrongRequester).toMatchObject({ verified: false, reason: "Challenge requester does not match." })
        const wrongHash = await store.vrfChal({ origin: challenge.origin, keyFileText: challenge.keyFileText + " ", requesterKey: "one", now: now + 2 })
        expect(wrongHash).toMatchObject({ verified: false, reason: "Key file checksum does not match." })
        expect(await store.isTrst(challenge.origin)).toBe(false)
        expect(await store.listChals(now + 3)).toHaveLength(1)
        expect((await store.vrfChal({ origin: challenge.origin, keyFileText: challenge.keyFileText, requesterKey: "one", now: now + 4 })).verified).toBe(true)
        const replay = await store.vrfChal({ origin: challenge.origin, keyFileText: challenge.keyFileText, requesterKey: "one", now: now + 5 })
        expect(replay).toMatchObject({ verified: false, reason: "Challenge was not found or has expired." })
    })

    test("malformed and foreign-service key files fail with their existing reasons", async () => {
        const { store } = await create()
        const orig = "https://example.org"
        expect(await store.vrfChal({ origin: orig, keyFileText: " ", now }))
            .toMatchObject({ verified: false, reason: "Key file content is required." })
        expect(await store.vrfChal({ origin: orig, keyFileText: "{", now }))
            .toMatchObject({ verified: false, reason: "Key file is not valid JSON." })
        expect(await store.vrfChal({ origin: orig, keyFileText: "[]", now }))
            .toMatchObject({ verified: false, reason: "Key file must contain a JSON object." })
        expect(await store.vrfChal({ origin: orig, keyFileText: '{"service":"foreign","origin":"https://example.org","challengeToken":"abc"}', now }))
            .toMatchObject({ verified: false, reason: "Key file service is invalid." })
    })

    test("expired challenges are pruned, and replacement challenges invalidate old keys", async () => {
        const { store } = await create({ challengeTtlMs: 500 })
        const first = await store.mkChal({ origin: "https://example.org", now })
        expect(await store.listChals(now + 499)).toHaveLength(1)
        expect((await store.vrfChal({ origin: first.origin, keyFileText: first.keyFileText, now: now + 500 })).verified).toBe(false)
        expect(await store.listChals(now + 500)).toEqual([])
        const second = await store.mkChal({ origin: "https://example.org", now: now + 600 })
        const third = await store.mkChal({ origin: "https://example.org", now: now + 700 })
        expect(second.challengeToken).not.toBe(third.challengeToken)
        expect((await store.vrfChal({ origin: third.origin, keyFileText: second.keyFileText, now: now + 750 })).verified).toBe(false)
        expect((await store.vrfChal({ origin: third.origin, keyFileText: third.keyFileText, now: now + 750 })).verified).toBe(true)
    })

    test("challenge deletion, site revocation and sorted listings remain the same", async () => {
        const { store } = await create()
        await store.mkChal({ origin: "https://z.example.org", now })
        await store.mkChal({ origin: "https://a.example.org", now })
        expect((await store.listChals(now)).map(v => v.origin)).toEqual(["https://a.example.org", "https://z.example.org"])
        expect(await store.delChal("https://z.example.org")).toBe(true)
        expect(await store.delChal("https://z.example.org")).toBe(false)
        const challenge = await store.mkChal({ origin: "https://z.example.org", now: now + 1 })
        expect((await store.vrfChal({ origin: challenge.origin, keyFileText: challenge.keyFileText, now: now + 2 })).verified).toBe(true)
        expect((await store.listSites()).map(v => v.origin)).toEqual(["https://z.example.org"])
        expect(await store.revSite("https://z.example.org")).toBe(true)
        expect(await store.revSite("https://z.example.org")).toBe(false)
        expect(await store.isTrst("https://z.example.org")).toBe(false)
        expect(await store.getSite("https://z.example.org")).toBeUndefined()
    })

    test("protobuf codec round-trips existing records without changing field types", async () => {
        const state = {
            pendingChallenges: {
                "https://example.org": {
                    origin: "https://example.org", challengeTokenHash: "hash1",
                    keyFileSha256: "hash2", createdAt: now, expiresAt: now + 1000,
                    verificationPath: "/.well-known/kittycrow.key", requesterKey: ""
                }
            },
            trustedSites: {},
            updatedAt: now
        }
        const encoded = pbCodec.encode(state)
        expect(pbCodec.decode(encoded)).toEqual(state)
        expect(pbCodec.encode(pbCodec.decode(encoded))).toEqual(encoded)
    })
})
