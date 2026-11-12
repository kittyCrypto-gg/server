import type { Uts, TrSitesState, TrSiteRec, PendSiteChal } from "./types"
import type { TrustedSitesContext } from "./context"

export function mkInitState(ctx: TrustedSitesContext): TrSitesState {
        return {
            pendingChallenges: {},
            trustedSites: {},
            updatedAt: Date.now()
        }
}

export function normState(ctx: TrustedSitesContext, val: unknown): TrSitesState {
        if (!ctx.isRec(val)) {
            return ctx.mkInitState()
        }

        return {
            pendingChallenges: ctx.normChals(val.pendingChallenges),
            trustedSites: ctx.normSites(val.trustedSites),
            updatedAt: ctx.normTs(val.updatedAt) ?? Date.now()
        }
}

export function normChals(ctx: TrustedSitesContext, val: unknown): Record<string, PendSiteChal> {
        if (!ctx.isRec(val)) {
            return {}
        }

        const out: Record<string, PendSiteChal> = {}

        for (const [orig, raw] of Object.entries(val)) {
            const chal = ctx.normChal(raw)

            if (!chal) {
                continue
            }

            out[orig] = chal
        }

        return out
}

export function normChal(ctx: TrustedSitesContext, val: unknown): PendSiteChal | undefined {
        if (!ctx.isRec(val)) {
            return undefined
        }

        const orig = ctx.normOptOrig(val.origin)
        const chalHash = ctx.normStr(val.challengeTokenHash)
        const keyFileHash = ctx.normStr(val.keyFileSha256)
        const madeAt = ctx.normTs(val.createdAt)
        const expAt = ctx.normTs(val.expiresAt)
        const vrfPath = ctx.normStr(val.verificationPath)
        const reqKey = ctx.normStr(val.requesterKey)

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

export function normSites(ctx: TrustedSitesContext, val: unknown): Record<string, TrSiteRec> {
        if (!ctx.isRec(val)) {
            return {}
        }

        const out: Record<string, TrSiteRec> = {}

        for (const [orig, raw] of Object.entries(val)) {
            const site = ctx.normSite(raw)

            if (!site) {
                continue
            }

            out[orig] = site
        }

        return out
}

export function normSite(ctx: TrustedSitesContext, val: unknown): TrSiteRec | undefined {
        if (!ctx.isRec(val)) {
            return undefined
        }

        const orig = ctx.normOptOrig(val.origin)
        const vrfAt = ctx.normTs(val.verifiedAt)
        const vrfPath = ctx.normStr(val.verificationPath)
        const lastChalAt = ctx.normTs(val.lastChallengeAt)

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

export function pruneChals(ctx: TrustedSitesContext, st: TrSitesState, now: Uts): TrSitesState {
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

export function normOptOrig(ctx: TrustedSitesContext, val: unknown): string | undefined {
        if (typeof val !== "string") {
            return undefined
        }

        try {
            return ctx.normOrig(val)
        } catch {
            return undefined
        }
}

export function normStr(ctx: TrustedSitesContext, val: unknown): string {
        return typeof val === "string" ? val.trim() : ""
}

export function normTs(ctx: TrustedSitesContext, val: unknown): Uts | undefined {
        if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
            return undefined
        }

        return Math.floor(val)
}

export function isRec(ctx: TrustedSitesContext, val: unknown): val is Record<string, unknown> {
        return typeof val === "object" && val !== null && !Array.isArray(val)
}
