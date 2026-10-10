import * as store from '../trustedSitesStore'
import type { Uts, MemKeyFile, RegSiteArgs, RegSiteRes, KeyFileArgs, KeyFileRes, ChkSiteArgs, ChkSiteRes } from './types'

export interface WorkflowContext {
    store: store.TrSitesStore
    srvBaseUrl?: string
    keyFiles: Map<string, MemKeyFile>
    siteToOrig(site: string): string
    mkSiteKey(origin: string): string
    mkDlUrl(args: { srvBaseUrl: string; origin: string }): string
    pruneKeyFiles(now: Uts): void
    fetchKeyFile(url: string): Promise<string>
}

    export async function regSite(ctx: WorkflowContext, args: RegSiteArgs): Promise<RegSiteRes> {
        const origin = ctx.siteToOrig(args.site)
        const siteKey = ctx.mkSiteKey(origin)
        const srvBaseUrl = args.srvBaseUrl?.trim() || ctx.srvBaseUrl

        if (!srvBaseUrl) {
            throw new Error("Server base URL is required to build the key-file download URL.")
        }

        const chal = await ctx.store.mkChal({
            origin,
            requesterKey: args.requesterKey,
            now: args.now
        })

        const keyFile: KeyFileRes = {
            fileName: "kittycrow.key",
            contentType: "application/json; charset=utf-8",
            body: chal.keyFileText,
            keyFileSha256: chal.keyFileSha256
        }

        ctx.keyFiles.set(origin, {
            origin,
            body: chal.keyFileText,
            keyFileSha256: chal.keyFileSha256,
            expiresAt: chal.expiresAt
        })

        ctx.pruneKeyFiles(args.now ?? Date.now())

        return {
            ...chal,
            siteKey,
            keyFileName: keyFile.fileName,
            keyFileDownloadUrl: ctx.mkDlUrl({
                srvBaseUrl,
                origin
            }),
            keyFile
        }
    }


    export function getKeyFile(ctx: WorkflowContext, args: KeyFileArgs): KeyFileRes {
        const origin = ctx.siteToOrig(args.site)
        const now = args.now ?? Date.now()

        ctx.pruneKeyFiles(now)

        const keyFile = ctx.keyFiles.get(origin)

        if (!keyFile || keyFile.expiresAt <= now) {
            throw new Error("Verification key file was not found or has expired. Register the site again.")
        }

        return {
            fileName: "kittycrow.key",
            contentType: "application/json; charset=utf-8",
            body: keyFile.body,
            keyFileSha256: keyFile.keyFileSha256
        }
    }


    export async function checkSite(ctx: WorkflowContext, args: ChkSiteArgs): Promise<ChkSiteRes> {
        const origin = ctx.siteToOrig(args.site)
        const verificationUrl = ctx.store.mkVrfUrl(origin)
        const keyFileText = await ctx.fetchKeyFile(verificationUrl)
        const fetchedKeyFileSha256 = ctx.store.hashKeyFile(keyFileText)

        const result = await ctx.store.vrfChal({
            origin,
            keyFileText,
            requesterKey: args.requesterKey,
            now: args.now
        })

        if (result.verified) {
            ctx.keyFiles.delete(origin)
        }

        return {
            ...result,
            verificationUrl,
            fetchedKeyFileSha256
        }
    }


    export function pruneKeyFiles(keyFiles: Map<string, MemKeyFile>, now: Uts): void {
        for (const [origin, keyFile] of keyFiles) {
            if (keyFile.expiresAt > now) {
                continue
            }

            keyFiles.delete(origin)
        }
    }

