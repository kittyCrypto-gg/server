import type { TrustedSitesContext } from "./context";
import type { MkChalArgs, MkChalRes, VrfChalArgs, VrfChalRes, TrSiteRec, KeyFilePayload } from "./types";


export async function mkChal(ctx: TrustedSitesContext, args: MkChalArgs): Promise<MkChalRes> {
    const orig = ctx.normOrig(args.origin)
    const now = args.now ?? Date.now()
    const chalTkn = ctx.mkChalTkn()
    const chalHash = ctx.hashChalTkn(chalTkn)
    const keyFileTxt = ctx.mkKeyFile(orig, chalTkn)
    const keyFileHash = ctx.hashKeyFile(keyFileTxt)
    const exp = now + ctx.ttlMs
    const reqKey = args.requesterKey?.trim() ?? ""

    await ctx.store.update((cur) => {
        const st = ctx.pruneChals(ctx.normState(cur), now)

        st.pendingChallenges[orig] = {
            origin: orig,
            challengeTokenHash: chalHash,
            keyFileSha256: keyFileHash,
            createdAt: now,
            expiresAt: exp,
            verificationPath: ctx.vrfPath,
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
        verificationPath: ctx.vrfPath,
        verificationUrl: ctx.mkVrfUrl(orig),
        expiresAt: exp
    }
}

export async function vrfChal(ctx: TrustedSitesContext, args: VrfChalArgs): Promise<VrfChalRes> {
    const orig = ctx.normOrig(args.origin)
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
        keyPayload = ctx.parseKeyFile(keyFileTxt)
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

    await ctx.store.update((cur) => {
        const st = ctx.pruneChals(ctx.normState(cur), now)
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

        const keyFileHash = ctx.hashKeyFile(keyFileTxt)

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

        const candHash = ctx.hashChalTkn(keyPayload.challengeToken)

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
