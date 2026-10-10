import * as store from '../trustedSitesStore'

export interface OriginContext {
    store: store.TrSitesStore
    safeDecode(value: string): string
    hasScheme(value: string): boolean
    mkRouteSite(origin: string): string
}

    export function mkSiteKey(ctx: OriginContext, origin: string): string {
        const normalisedOrigin = ctx.store.normOrig(origin)
        const url = new URL(normalisedOrigin)

        const hostKey = url.hostname
            .toLowerCase()
            .replace(/\.$/, "")
            .replace(/^www\./, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .replace(/-+/g, "-")

        if (!hostKey) {
            throw new Error("Site origin could not be converted into a site key.")
        }

        return url.port ? `${hostKey}-${url.port}` : hostKey
    }


    export function readSiteParam(ctx: OriginContext, site: unknown): string {
        if (typeof site !== "string" || !site.trim()) {
            throw new Error("Route requires a site parameter.")
        }

        return site
    }


    export function siteToOrig(ctx: OriginContext, site: string): string {
        const decoded = ctx.safeDecode(site).trim()

        if (!decoded) {
            throw new Error("Site parameter is required.")
        }

        if (ctx.hasScheme(decoded)) {
            return ctx.store.normOrig(decoded)
        }

        return ctx.store.normOrig(`https://${decoded}`)
    }


    export function safeDecode(ctx: OriginContext, value: string): string {
        try {
            return decodeURIComponent(value)
        } catch {
            return value
        }
    }


    export function hasScheme(ctx: OriginContext, value: string): boolean {
        return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    }


    export function mkRouteSite(ctx: OriginContext, origin: string): string {
        const normalisedOrigin = ctx.store.normOrig(origin)
        const url = new URL(normalisedOrigin)

        return url.host.toLowerCase()
    }


    export function mkDlUrl(ctx: OriginContext, args: {
        srvBaseUrl: string
        origin: string
    }): string {
        const routeSite = ctx.mkRouteSite(args.origin)
        const url = new URL(`/verify/${encodeURIComponent(routeSite)}/kittycrow.key`, args.srvBaseUrl)

        return url.toString()
    }

