import type { TrustedSitesContext } from "./context";
import type { Uts, TrSiteRec, PendSiteChal } from "./types";


export async function isTrst(ctx: TrustedSitesContext, origin: string): Promise<boolean> {
    const orig = ctx.normOrig(origin)
    const st = ctx.normState(await ctx.store.read())

    return typeof st.trustedSites[orig] !== "undefined"
}

export async function getSite(ctx: TrustedSitesContext, origin: string): Promise<TrSiteRec | undefined> {
    const orig = ctx.normOrig(origin)
    const st = ctx.normState(await ctx.store.read())

    return st.trustedSites[orig]
}

export async function listSites(ctx: TrustedSitesContext): Promise<TrSiteRec[]> {
    const st = ctx.normState(await ctx.store.read())

    return Object.values(st.trustedSites).sort((left, right) =>
        left.origin.localeCompare(right.origin)
    )
}

export async function listChals(ctx: TrustedSitesContext, now: Uts = Date.now()): Promise<PendSiteChal[]> {
    const st = await ctx.store.update((cur) => {
        const next = ctx.pruneChals(ctx.normState(cur), now)

        next.updatedAt = now

        return next
    })

    return Object.values(st.pendingChallenges).sort((left, right) =>
        left.origin.localeCompare(right.origin)
    )
}

export async function revSite(ctx: TrustedSitesContext, origin: string): Promise<boolean> {
    const orig = ctx.normOrig(origin)
    let gone = false

    await ctx.store.update((cur) => {
        const st = ctx.normState(cur)

        gone = typeof st.trustedSites[orig] !== "undefined"

        delete st.trustedSites[orig]
        st.updatedAt = Date.now()

        return st
    })

    return gone
}

export async function delChal(ctx: TrustedSitesContext, origin: string): Promise<boolean> {
    const orig = ctx.normOrig(origin)
    let gone = false

    await ctx.store.update((cur) => {
        const st = ctx.normState(cur)

        gone = typeof st.pendingChallenges[orig] !== "undefined"

        delete st.pendingChallenges[orig]
        st.updatedAt = Date.now()

        return st
    })

    return gone
}
