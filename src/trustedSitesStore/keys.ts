import type { KeyFilePayload } from "./types"
import type { TrustedSitesContext } from "./context"

export const keyFileService = "kittycrow-visits"

export function parseKeyFile(ctx: TrustedSitesContext, keyFileTxt: string): KeyFilePayload {
        let raw: unknown

        try {
            raw = JSON.parse(keyFileTxt)
        } catch {
            throw new Error("Key file is not valid JSON.")
        }

        if (!ctx.isRec(raw)) {
            throw new Error("Key file must contain a JSON object.")
        }

        const service = ctx.normStr(raw.service)
        const origin = ctx.normOptOrig(raw.origin)
        const challengeToken = ctx.normStr(raw.challengeToken)

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
