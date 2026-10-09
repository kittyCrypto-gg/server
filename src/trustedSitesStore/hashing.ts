import * as crypto from "crypto"
import type { TrustedSitesContext } from "./context"

export function mkChalTkn(ctx: TrustedSitesContext): string {
        return crypto.randomBytes(32).toString("base64url")
}

export function hashChalTkn(ctx: TrustedSitesContext, chalTkn: string): string {
        return ctx.sha256Txt(chalTkn)
}

export function sha256Txt(ctx: TrustedSitesContext, val: string): string {
        return crypto
            .createHash("sha256")
            .update(val, "utf8")
            .digest("hex")
}
