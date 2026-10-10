import type { TrustedSitesContext } from "./context";
import { keyFileService } from "./keys";


export function normOrig(ctx: TrustedSitesContext, val: string): string {
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

    if (ctx.allowHttp && url.protocol === "http:") {
        return url.origin
    }

    throw new Error("Site origin must use HTTPS.")
}

export function mkVrfUrl(ctx: TrustedSitesContext, origin: string): string {
    const orig = ctx.normOrig(origin)

    return `${orig}${ctx.vrfPath}`
}

export function mkKeyFile(ctx: TrustedSitesContext, origin: string, chalTkn: string): string {
    const orig = ctx.normOrig(origin)
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

export function hashKeyFile(ctx: TrustedSitesContext, keyFileTxt: string): string {
    return ctx.sha256Txt(keyFileTxt)
}
