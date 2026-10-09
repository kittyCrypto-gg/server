import * as path from "path"
import { MutexProtoBuffStore } from "./mutexPBstore"
import type { Uts, TrSiteRec, PendSiteChal, TrSitesOpts, MkChalArgs, MkChalRes, VrfChalArgs, VrfChalRes, TrSitesState, KeyFilePayload } from "./trustedSitesStore/types"
import { pbCodec } from "./trustedSitesStore/schema"
import { keyFileService } from "./trustedSitesStore/keys"
import type { TrustedSitesContext } from "./trustedSitesStore/context"
import { mkInitState as mkInitState_operation, normState as normState_operation, normChals as normChals_operation, normChal as normChal_operation, normSites as normSites_operation, normSite as normSite_operation, pruneChals as pruneChals_operation, normOptOrig as normOptOrig_operation, normStr as normStr_operation, normTs as normTs_operation, isRec as isRec_operation } from "./trustedSitesStore/state"
import { parseKeyFile as parseKeyFile_operation } from "./trustedSitesStore/keys"
import { mkChalTkn as mkChalTkn_operation, hashChalTkn as hashChalTkn_operation, sha256Txt as sha256Txt_operation } from "./trustedSitesStore/hashing"

export type { TrSiteRec, PendSiteChal, TrSitesOpts, MkChalArgs, MkChalRes, VrfChalArgs, VrfChalRes } from "./trustedSitesStore/types"

export class TrSitesStore {
    private readonly store: MutexProtoBuffStore<TrSitesState>
    private readonly ttlMs: number
    private readonly vrfPath: string
    private readonly allowHttp: boolean

    public constructor(opts: TrSitesOpts = {}) {
        this.ttlMs = opts.challengeTtlMs ?? 30 * 60_000
        this.vrfPath = opts.verificationPath ?? "/.well-known/kittycrow.key"
        this.allowHttp = opts.allowHttp ?? false

        this.store = new MutexProtoBuffStore<TrSitesState>({
            filePath: opts.filePath ?? path.resolve(process.cwd(), "data", "trustedSites.pb"),
            lockTimeoutMs: opts.lockTimeoutMs,
            lockRetryDelayMs: opts.lockRetryDelayMs,
            initialValue: () => this.mkInitState(),
            codec: pbCodec
        })
    }

    public async mkChal(args: MkChalArgs): Promise<MkChalRes> {
        const orig = this.normOrig(args.origin)
        const now = args.now ?? Date.now()
        const chalTkn = this.mkChalTkn()
        const chalHash = this.hashChalTkn(chalTkn)
        const keyFileTxt = this.mkKeyFile(orig, chalTkn)
        const keyFileHash = this.hashKeyFile(keyFileTxt)
        const exp = now + this.ttlMs
        const reqKey = args.requesterKey?.trim() ?? ""

        await this.store.update((cur) => {
            const st = this.pruneChals(this.normState(cur), now)

            st.pendingChallenges[orig] = {
                origin: orig,
                challengeTokenHash: chalHash,
                keyFileSha256: keyFileHash,
                createdAt: now,
                expiresAt: exp,
                verificationPath: this.vrfPath,
                requesterKey: reqKey
            }

            st.updatedAt = now

            return st
        })

        return {
            origin: orig,
            challengeToken: chalTkn,
            challengeTokenHash: chalHash,
            keyFileSha256: keyFileHash,
            keyFileText: keyFileTxt,
            verificationPath: this.vrfPath,
            verificationUrl: this.mkVrfUrl(orig),
            expiresAt: exp
        }
    }

    public async vrfChal(args: VrfChalArgs): Promise<VrfChalRes> {
        const orig = this.normOrig(args.origin)
        const keyFileTxt = args.keyFileText
        const reqKey = args.requesterKey?.trim() ?? ""
        const now = args.now ?? Date.now()

        if (!keyFileTxt.trim()) {
            return {
                verified: false,
                origin: orig,
                reason: "Key file content is required."
            }
        }

        let keyPayload: KeyFilePayload

        try {
            keyPayload = this.parseKeyFile(keyFileTxt)
        } catch (err: unknown) {
            return {
                verified: false,
                origin: orig,
                reason: err instanceof Error ? err.message : "Key file is invalid."
            }
        }

        let res: VrfChalRes = {
            verified: false,
            origin: orig,
            reason: "Challenge was not found."
        }

        await this.store.update((cur) => {
            const st = this.pruneChals(this.normState(cur), now)
            const chal = st.pendingChallenges[orig]

            if (!chal) {
                res = {
                    verified: false,
                    origin: orig,
                    reason: "Challenge was not found or has expired."
                }

                return st
            }

            if (chal.requesterKey && chal.requesterKey !== reqKey) {
                res = {
                    verified: false,
                    origin: orig,
                    reason: "Challenge requester does not match."
                }

                return st
            }

            const keyFileHash = this.hashKeyFile(keyFileTxt)

            if (keyFileHash !== chal.keyFileSha256) {
                res = {
                    verified: false,
                    origin: orig,
                    reason: "Key file checksum does not match."
                }

                return st
            }

            if (keyPayload.origin !== orig) {
                res = {
                    verified: false,
                    origin: orig,
                    reason: "Key file origin does not match."
                }

                return st
            }

            const candHash = this.hashChalTkn(keyPayload.challengeToken)

            if (candHash !== chal.challengeTokenHash) {
                res = {
                    verified: false,
                    origin: orig,
                    reason: "Challenge token does not match."
                }

                return st
            }

            const site: TrSiteRec = {
                origin: orig,
                verifiedAt: now,
                verificationPath: chal.verificationPath,
                lastChallengeAt: chal.createdAt
            }

            st.trustedSites[orig] = site
            delete st.pendingChallenges[orig]
            st.updatedAt = now

            res = {
                verified: true,
                origin: orig,
                trustedSite: site
            }

            return st
        })

        return res
    }

    public async isTrst(origin: string): Promise<boolean> {
        const orig = this.normOrig(origin)
        const st = this.normState(await this.store.read())

        return typeof st.trustedSites[orig] !== "undefined"
    }

    public async getSite(origin: string): Promise<TrSiteRec | undefined> {
        const orig = this.normOrig(origin)
        const st = this.normState(await this.store.read())

        return st.trustedSites[orig]
    }

    public async listSites(): Promise<TrSiteRec[]> {
        const st = this.normState(await this.store.read())

        return Object.values(st.trustedSites).sort((left, right) =>
            left.origin.localeCompare(right.origin)
        )
    }

    public async listChals(now: Uts = Date.now()): Promise<PendSiteChal[]> {
        const st = await this.store.update((cur) => {
            const next = this.pruneChals(this.normState(cur), now)

            next.updatedAt = now

            return next
        })

        return Object.values(st.pendingChallenges).sort((left, right) =>
            left.origin.localeCompare(right.origin)
        )
    }

    public async revSite(origin: string): Promise<boolean> {
        const orig = this.normOrig(origin)
        let gone = false

        await this.store.update((cur) => {
            const st = this.normState(cur)

            gone = typeof st.trustedSites[orig] !== "undefined"

            delete st.trustedSites[orig]
            st.updatedAt = Date.now()

            return st
        })

        return gone
    }

    public async delChal(origin: string): Promise<boolean> {
        const orig = this.normOrig(origin)
        let gone = false

        await this.store.update((cur) => {
            const st = this.normState(cur)

            gone = typeof st.pendingChallenges[orig] !== "undefined"

            delete st.pendingChallenges[orig]
            st.updatedAt = Date.now()

            return st
        })

        return gone
    }

    public normOrig(val: string): string {
        const txt = val.trim()

        if (!txt) {
            throw new Error("Site origin is required.")
        }

        const url = new URL(txt)

        if (url.username || url.password) {
            throw new Error("Site origin must not include credentials.")
        }

        if (url.pathname !== "/" || url.search || url.hash) {
            throw new Error("Site origin must not include a path, query, or hash.")
        }

        if (url.protocol === "https:") {
            return url.origin
        }

        if (this.allowHttp && url.protocol === "http:") {
            return url.origin
        }

        throw new Error("Site origin must use HTTPS.")
    }

    public mkVrfUrl(origin: string): string {
        const orig = this.normOrig(origin)

        return `${orig}${this.vrfPath}`
    }

    public mkKeyFile(origin: string, chalTkn: string): string {
        const orig = this.normOrig(origin)
        const token = chalTkn.trim()

        if (!token) {
            throw new Error("Challenge token is required.")
        }

        return `${JSON.stringify({
            service: keyFileService,
            origin: orig,
            challengeToken: token
        }, null, 4)}\n`
    }

    public hashKeyFile(keyFileTxt: string): string {
        return this.sha256Txt(keyFileTxt)
    }

    private mkInitState(): TrSitesState {
        return mkInitState_operation(this as unknown as TrustedSitesContext);
    }

    private normState(val: unknown): TrSitesState {
        return normState_operation(this as unknown as TrustedSitesContext, val);
    }

    private normChals(val: unknown): Record<string, PendSiteChal> {
        return normChals_operation(this as unknown as TrustedSitesContext, val);
    }

    private normChal(val: unknown): PendSiteChal | undefined {
        return normChal_operation(this as unknown as TrustedSitesContext, val);
    }

    private normSites(val: unknown): Record<string, TrSiteRec> {
        return normSites_operation(this as unknown as TrustedSitesContext, val);
    }

    private normSite(val: unknown): TrSiteRec | undefined {
        return normSite_operation(this as unknown as TrustedSitesContext, val);
    }

    private pruneChals(st: TrSitesState, now: Uts): TrSitesState {
        return pruneChals_operation(this as unknown as TrustedSitesContext, st, now);
    }

    private mkChalTkn(): string {
        return mkChalTkn_operation(this as unknown as TrustedSitesContext);
    }

    private hashChalTkn(chalTkn: string): string {
        return hashChalTkn_operation(this as unknown as TrustedSitesContext, chalTkn);
    }

    private parseKeyFile(keyFileTxt: string): KeyFilePayload {
        return parseKeyFile_operation(this as unknown as TrustedSitesContext, keyFileTxt);
    }

    private sha256Txt(val: string): string {
        return sha256Txt_operation(this as unknown as TrustedSitesContext, val);
    }

    private normOptOrig(val: unknown): string | undefined {
        return normOptOrig_operation(this as unknown as TrustedSitesContext, val);
    }

    private normStr(val: unknown): string {
        return normStr_operation(this as unknown as TrustedSitesContext, val);
    }

    private normTs(val: unknown): Uts | undefined {
        return normTs_operation(this as unknown as TrustedSitesContext, val);
    }

    private isRec(val: unknown): val is Record<string, unknown> {
        return isRec_operation(this as unknown as TrustedSitesContext, val);
    }
}
