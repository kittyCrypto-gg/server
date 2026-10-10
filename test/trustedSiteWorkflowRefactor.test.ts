import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrSitesStore } from "../src/trustedSitesStore";

test("extracted challenge handlers retain virtual public hooks", async () => {
    const folder = await mkdtemp(join(tmpdir(), "trusted-workflows-"));
    try {
        const invoked: string[] = [];
        class ExtendedTrustedSitesStore extends TrSitesStore {
            public override normOrig(origin: string): string {
                invoked.push("normOrig");
                return super.normOrig(origin);
            }
            public override hashKeyFile(value: string): string {
                invoked.push("hashKeyFile");
                return super.hashKeyFile(value);
            }
            public override mkKeyFile(origin: string, challengeToken: string): string {
                invoked.push("mkKeyFile");
                return super.mkKeyFile(origin, challengeToken);
            }
        }
        const store = new ExtendedTrustedSitesStore({ filePath: join(folder, "sites.pb") });
        const now = 1_800_000_000_000;
        const chal = await store.mkChal({ origin: "https://EXAMPLE.org", now });
        expect(chal.origin).toBe("https://example.org");
        const verified = await store.vrfChal({
            origin: chal.origin, keyFileText: chal.keyFileText, now: now + 20
        });
        expect(verified.verified).toBe(true);
        expect(await store.isTrst(chal.origin)).toBe(true);
        expect(invoked.filter(x => x === "mkKeyFile").length).toBe(1);
        expect(invoked.filter(x => x === "hashKeyFile").length).toBeGreaterThanOrEqual(2);
        expect(invoked.filter(x => x === "normOrig").length).toBeGreaterThanOrEqual(4);
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
});
