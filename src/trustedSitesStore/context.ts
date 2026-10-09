import type { MutexProtoBuffStore } from "../mutexPBstore"
import type { Uts, TrSitesState, TrSiteRec, PendSiteChal, KeyFilePayload, MkChalArgs, MkChalRes, VrfChalArgs, VrfChalRes } from "./types"

export interface TrustedSitesContext {
    store: MutexProtoBuffStore<TrSitesState>
    ttlMs: number
    vrfPath: string
    allowHttp: boolean
    mkChal(args: MkChalArgs): Promise<MkChalRes>;
    vrfChal(args: VrfChalArgs): Promise<VrfChalRes>;
    isTrst(origin: string): Promise<boolean>;
    getSite(origin: string): Promise<TrSiteRec | undefined>;
    listSites(): Promise<TrSiteRec[]>;
    listChals(now?: Uts): Promise<PendSiteChal[]>;
    revSite(origin: string): Promise<boolean>;
    delChal(origin: string): Promise<boolean>;
    normOrig(val: string): string;
    mkVrfUrl(origin: string): string;
    mkKeyFile(origin: string, chalTkn: string): string;
    hashKeyFile(keyFileTxt: string): string;
    mkInitState(): TrSitesState;
    normState(val: unknown): TrSitesState;
    normChals(val: unknown): Record<string, PendSiteChal>;
    normChal(val: unknown): PendSiteChal | undefined;
    normSites(val: unknown): Record<string, TrSiteRec>;
    normSite(val: unknown): TrSiteRec | undefined;
    pruneChals(st: TrSitesState, now: Uts): TrSitesState;
    mkChalTkn(): string;
    hashChalTkn(chalTkn: string): string;
    parseKeyFile(keyFileTxt: string): KeyFilePayload;
    sha256Txt(val: string): string;
    normOptOrig(val: unknown): string | undefined;
    normStr(val: unknown): string;
    normTs(val: unknown): Uts | undefined;
    isRec(val: unknown): val is Record<string, unknown>;
}
