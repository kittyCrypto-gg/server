import * as crypto from "crypto"
import * as path from "path"
import * as protobuf from "protobufjs"
import type { IConversionOptions } from "protobufjs"
import { MutexProtoBuffStore, ProtoBuffCodec } from "./mutexPBstore"

type Uts = number

export type TrSiteRec = {
    origin: string
    verifiedAt: Uts
    verificationPath: string
    lastChallengeAt: Uts
}

export type PendSiteChal = {
    origin: string
    challengeTokenHash: string
    keyFileSha256: string
    createdAt: Uts
    expiresAt: Uts
    verificationPath: string
    requesterKey: string
}

type TrSitesState = {
    pendingChallenges: Record<string, PendSiteChal>
    trustedSites: Record<string, TrSiteRec>
    updatedAt: Uts
}

export type TrSitesOpts = {
    filePath?: string
    challengeTtlMs?: number
    verificationPath?: string
    allowHttp?: boolean
    lockTimeoutMs?: number
    lockRetryDelayMs?: number
}

export type MkChalArgs = {
    origin: string
    requesterKey?: string
    now?: Uts
}

export type MkChalRes = {
    origin: string
    challengeToken: string
    challengeTokenHash: string
    keyFileSha256: string
    keyFileText: string
    verificationPath: string
    verificationUrl: string
    expiresAt: Uts
}

export type VrfChalArgs = {
    origin: string
    keyFileText: string
    requesterKey?: string
    now?: Uts
}

export type VrfChalRes = {
    verified: boolean
    origin: string
    trustedSite?: TrSiteRec
    reason?: string
}

type KeyFilePayload = {
    service: string
    origin: string
    challengeToken: string
}

const keyFileService = "kittycrow-visits"

const pbSchema = `
syntax = "proto3";

message PendingTrustedSiteChallenge {
    string origin = 1;
    string challengeTokenHash = 2;
    int64 createdAt = 3;
    int64 expiresAt = 4;
    string verificationPath = 5;
    string requesterKey = 6;
    string keyFileSha256 = 7;
}

message TrustedSiteRecord {
    string origin = 1;
    int64 verifiedAt = 2;
    string verificationPath = 3;
    int64 lastChallengeAt = 4;
}

message TrustedSitesState {
    map<string, PendingTrustedSiteChallenge> pendingChallenges = 1;
    map<string, TrustedSiteRecord> trustedSites = 2;
    int64 updatedAt = 3;
}
`

const pbRoot = protobuf.parse(pbSchema).root
const pbType = pbRoot.lookupType("TrustedSitesState")

const pbConv: IConversionOptions = {
    longs: Number,
    enums: String,
    defaults: true,
    arrays: true,
    objects: true
}

const pbCodec: ProtoBuffCodec<TrSitesState> = {
    encode: (val: TrSitesState): Buffer => {
        const err = pbType.verify(val)

        if (err !== null) {
            throw new Error(`TrSitesStore cannot encode invalid protobuf payload: ${err}`)
        }

        const msg = pbType.fromObject(val)
        const enc = pbType.encode(msg).finish()

        return Buffer.from(enc)
    },

    decode: (raw: Buffer): TrSitesState => {
        const msg = pbType.decode(raw)
        const obj = pbType.toObject(msg, pbConv)

        return obj as TrSitesState
    }
}

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
        return {
            pendingChallenges: {},
            trustedSites: {},
            updatedAt: Date.now()
        }
    }

    private normState(val: unknown): TrSitesState {
        if (!this.isRec(val)) {
            return this.mkInitState()
        }

        return {
            pendingChallenges: this.normChals(val.pendingChallenges),
            trustedSites: this.normSites(val.trustedSites),
            updatedAt: this.normTs(val.updatedAt) ?? Date.now()
        }
    }

    private normChals(val: unknown): Record<string, PendSiteChal> {
        if (!this.isRec(val)) {
            return {}
        }

        const out: Record<string, PendSiteChal> = {}

        for (const [orig, raw] of Object.entries(val)) {
            const chal = this.normChal(raw)

            if (!chal) {
                continue
            }

            out[orig] = chal
        }

        return out
    }

    private normChal(val: unknown): PendSiteChal | undefined {
        if (!this.isRec(val)) {
            return undefined
        }

        const orig = this.normOptOrig(val.origin)
        const chalHash = this.normStr(val.challengeTokenHash)
        const keyFileHash = this.normStr(val.keyFileSha256)
        const madeAt = this.normTs(val.createdAt)
        const expAt = this.normTs(val.expiresAt)
        const vrfPath = this.normStr(val.verificationPath)
        const reqKey = this.normStr(val.requesterKey)

        if (!orig || !chalHash || !keyFileHash || !madeAt || !expAt || !vrfPath) {
            return undefined
        }

        return {
            origin: orig,
            challengeTokenHash: chalHash,
            keyFileSha256: keyFileHash,
            createdAt: madeAt,
            expiresAt: expAt,
            verificationPath: vrfPath,
            requesterKey: reqKey
        }
    }

    private normSites(val: unknown): Record<string, TrSiteRec> {
        if (!this.isRec(val)) {
            return {}
        }

        const out: Record<string, TrSiteRec> = {}

        for (const [orig, raw] of Object.entries(val)) {
            const site = this.normSite(raw)

            if (!site) {
                continue
            }

            out[orig] = site
        }

        return out
    }

    private normSite(val: unknown): TrSiteRec | undefined {
        if (!this.isRec(val)) {
            return undefined
        }

        const orig = this.normOptOrig(val.origin)
        const vrfAt = this.normTs(val.verifiedAt)
        const vrfPath = this.normStr(val.verificationPath)
        const lastChalAt = this.normTs(val.lastChallengeAt)

        if (!orig || !vrfAt || !vrfPath || !lastChalAt) {
            return undefined
        }

        return {
            origin: orig,
            verifiedAt: vrfAt,
            verificationPath: vrfPath,
            lastChallengeAt: lastChalAt
        }
    }

    private pruneChals(st: TrSitesState, now: Uts): TrSitesState {
        const pendingChallenges: Record<string, PendSiteChal> = {}

        for (const [orig, chal] of Object.entries(st.pendingChallenges)) {
            if (chal.expiresAt > now) {
                pendingChallenges[orig] = chal
            }
        }

        return {
            pendingChallenges,
            trustedSites: st.trustedSites,
            updatedAt: st.updatedAt
        }
    }

    private mkChalTkn(): string {
        return crypto.randomBytes(32).toString("base64url")
    }

    private hashChalTkn(chalTkn: string): string {
        return this.sha256Txt(chalTkn)
    }

    private parseKeyFile(keyFileTxt: string): KeyFilePayload {
        let raw: unknown

        try {
            raw = JSON.parse(keyFileTxt)
        } catch {
            throw new Error("Key file is not valid JSON.")
        }

        if (!this.isRec(raw)) {
            throw new Error("Key file must contain a JSON object.")
        }

        const service = this.normStr(raw.service)
        const origin = this.normOptOrig(raw.origin)
        const challengeToken = this.normStr(raw.challengeToken)

        if (service !== keyFileService) {
            throw new Error("Key file service is invalid.")
        }

        if (!origin) {
            throw new Error("Key file origin is invalid.")
        }

        if (!challengeToken) {
            throw new Error("Key file challenge token is missing.")
        }

        return {
            service,
            origin,
            challengeToken
        }
    }

    private sha256Txt(val: string): string {
        return crypto
            .createHash("sha256")
            .update(val, "utf8")
            .digest("hex")
    }

    private normOptOrig(val: unknown): string | undefined {
        if (typeof val !== "string") {
            return undefined
        }

        try {
            return this.normOrig(val)
        } catch {
            return undefined
        }
    }

    private normStr(val: unknown): string {
        return typeof val === "string" ? val.trim() : ""
    }

    private normTs(val: unknown): Uts | undefined {
        if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
            return undefined
        }

        return Math.floor(val)
    }

    private isRec(val: unknown): val is Record<string, unknown> {
        return typeof val === "object" && val !== null && !Array.isArray(val)
    }
}