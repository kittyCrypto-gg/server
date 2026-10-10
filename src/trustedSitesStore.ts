import * as path from "path"
import { MutexProtoBuffStore } from "./mutexPBstore"
import type { Uts, TrSiteRec, PendSiteChal, TrSitesOpts, MkChalArgs, MkChalRes, VrfChalArgs, VrfChalRes, TrSitesState, KeyFilePayload } from "./trustedSitesStore/types"
import { pbCodec } from "./trustedSitesStore/schema"
import { mkChal as mkChal_operation, vrfChal as vrfChal_operation } from "./trustedSitesStore/challenges";
import { isTrst as isTrst_operation, getSite as getSite_operation, listSites as listSites_operation, listChals as listChals_operation, revSite as revSite_operation, delChal as delChal_operation } from "./trustedSitesStore/sites";
import { normOrig as normOrig_operation, mkVrfUrl as mkVrfUrl_operation, mkKeyFile as mkKeyFile_operation, hashKeyFile as hashKeyFile_operation } from "./trustedSitesStore/origins";
import type { TrustedSitesContext } from "./trustedSitesStore/context"
import { mkInitState as mkInitState_operation, normState as normState_operation, normChals as normChals_operation, normChal as normChal_operation, normSites as normSites_operation, normSite as normSite_operation, pruneChals as pruneChals_operation, normOptOrig as normOptOrig_operation, normStr as normStr_operation, normTs as normTs_operation, isRec as isRec_operation } from "./trustedSitesStore/state"
import { parseKeyFile as parseKeyFile_operation } from "./trustedSitesStore/keys"
import { mkChalTkn as mkChalTkn_operation, hashChalTkn as hashChalTkn_operation, sha256Txt as sha256Txt_operation } from "./trustedSitesStore/hashing"

export type { TrSiteRec, PendSiteChal, TrSitesOpts, MkChalArgs, MkChalRes, VrfChalArgs, VrfChalRes } from "./trustedSitesStore/types"

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
        return mkChal_operation(this as unknown as TrustedSitesContext, args);
    }

    public async vrfChal(args: VrfChalArgs): Promise<VrfChalRes> {
        return vrfChal_operation(this as unknown as TrustedSitesContext, args);
    }

    public async isTrst(origin: string): Promise<boolean> {
        return isTrst_operation(this as unknown as TrustedSitesContext, origin);
    }

    public async getSite(origin: string): Promise<TrSiteRec | undefined> {
        return getSite_operation(this as unknown as TrustedSitesContext, origin);
    }

    public async listSites(): Promise<TrSiteRec[]> {
        return listSites_operation(this as unknown as TrustedSitesContext);
    }

    public async listChals(now: Uts = Date.now()): Promise<PendSiteChal[]> {
        return listChals_operation(this as unknown as TrustedSitesContext, now);
    }

    public async revSite(origin: string): Promise<boolean> {
        return revSite_operation(this as unknown as TrustedSitesContext, origin);
    }

    public async delChal(origin: string): Promise<boolean> {
        return delChal_operation(this as unknown as TrustedSitesContext, origin);
    }

    public normOrig(val: string): string {
        return normOrig_operation(this as unknown as TrustedSitesContext, val);
    }

    public mkVrfUrl(origin: string): string {
        return mkVrfUrl_operation(this as unknown as TrustedSitesContext, origin);
    }

    public mkKeyFile(origin: string, chalTkn: string): string {
        return mkKeyFile_operation(this as unknown as TrustedSitesContext, origin, chalTkn);
    }

    public hashKeyFile(keyFileTxt: string): string {
        return hashKeyFile_operation(this as unknown as TrustedSitesContext, keyFileTxt);
    }

    private mkInitState(): TrSitesState {
        return mkInitState_operation(this as unknown as TrustedSitesContext);
    }

    private normState(val: unknown): TrSitesState {
        return normState_operation(this as unknown as TrustedSitesContext, val);
    }

    private normChals(val: unknown): Record<string, PendSiteChal> {
        return normChals_operation(this as unknown as TrustedSitesContext, val);
    }

    private normChal(val: unknown): PendSiteChal | undefined {
        return normChal_operation(this as unknown as TrustedSitesContext, val);
    }

    private normSites(val: unknown): Record<string, TrSiteRec> {
        return normSites_operation(this as unknown as TrustedSitesContext, val);
    }

    private normSite(val: unknown): TrSiteRec | undefined {
        return normSite_operation(this as unknown as TrustedSitesContext, val);
    }

    private pruneChals(st: TrSitesState, now: Uts): TrSitesState {
        return pruneChals_operation(this as unknown as TrustedSitesContext, st, now);
    }

    private mkChalTkn(): string {
        return mkChalTkn_operation(this as unknown as TrustedSitesContext);
    }

    private hashChalTkn(chalTkn: string): string {
        return hashChalTkn_operation(this as unknown as TrustedSitesContext, chalTkn);
    }

    private parseKeyFile(keyFileTxt: string): KeyFilePayload {
        return parseKeyFile_operation(this as unknown as TrustedSitesContext, keyFileTxt);
    }

    private sha256Txt(val: string): string {
        return sha256Txt_operation(this as unknown as TrustedSitesContext, val);
    }

    private normOptOrig(val: unknown): string | undefined {
        return normOptOrig_operation(this as unknown as TrustedSitesContext, val);
    }

    private normStr(val: unknown): string {
        return normStr_operation(this as unknown as TrustedSitesContext, val);
    }

    private normTs(val: unknown): Uts | undefined {
        return normTs_operation(this as unknown as TrustedSitesContext, val);
    }

    private isRec(val: unknown): val is Record<string, unknown> {
        return isRec_operation(this as unknown as TrustedSitesContext, val);
    }
}

