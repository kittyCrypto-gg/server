import type { FetchLike } from './types'

export interface NetworkContext {
    fetchFn: FetchLike
    fetchTimeoutMs: number
    maxKeyFileBytes: number
    assertKeyFileLen(value: string | null): void
    assertKeyFileTxtLen(value: string): void
}

    export async function fetchKeyFile(ctx: NetworkContext, url: string): Promise<string> {
        const ctl = new AbortController()
        const timeout = setTimeout(() => ctl.abort(), ctx.fetchTimeoutMs)

        try {
            const res = await ctx.fetchFn(url, {
                signal: ctl.signal
            })

            if (!res.ok) {
                throw new Error(`Verification key file returned HTTP ${String(res.status)}.`)
            }

            ctx.assertKeyFileLen(res.headers.get("content-length"))

            const txt = await res.text()

            ctx.assertKeyFileTxtLen(txt)

            return txt
        } finally {
            clearTimeout(timeout)
        }
    }


    export function assertKeyFileLen(ctx: NetworkContext, contentLength: string | null): void {
        if (contentLength === null) {
            return
        }

        const size = Number(contentLength)

        if (!Number.isFinite(size) || size <= ctx.maxKeyFileBytes) {
            return
        }

        throw new Error("Verification key file is too large.")
    }


    export function assertKeyFileTxtLen(ctx: NetworkContext, txt: string): void {
        const size = Buffer.byteLength(txt, "utf8")

        if (size <= ctx.maxKeyFileBytes) {
            return
        }

        throw new Error("Verification key file is too large.")
    }


    export async function defaultFetch(url: string, init?: { signal?: AbortSignal }): Promise<{
        ok: boolean
        status: number
        headers: {
            get: (name: string) => string | null
        }
        text: () => Promise<string>
    }> {
        if (typeof globalThis.fetch !== "function") {
            throw new Error("Fetch is not available. Provide fetchFn in TrSitesLogicOpts.")
        }

        return await globalThis.fetch(url, init)
    }