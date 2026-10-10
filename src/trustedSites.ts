import * as store from './trustedSitesStore'
import type { Uts, FetchLike, MemKeyFile, TrSitesLogicOpts, RegSiteArgs, RegSiteRes, KeyFileArgs, KeyFileRes, ChkSiteArgs, ChkSiteRes } from './trustedSites/types'
import * as origins from './trustedSites/origins'
import * as workflows from './trustedSites/workflows'
import * as network from './trustedSites/network'

export type { TrSitesLogicOpts, RegSiteArgs, RegSiteRes, KeyFileArgs, KeyFileRes, ChkSiteArgs, ChkSiteRes } from './trustedSites/types'

export class TrSites {
    private readonly store: store.TrSitesStore
    private readonly fetchFn: FetchLike
    private readonly srvBaseUrl?: string
    private readonly maxKeyFileBytes: number
    private readonly fetchTimeoutMs: number
    private readonly keyFiles: Map<string, MemKeyFile>

    public constructor(opts: TrSitesLogicOpts = {}) {
        this.store = opts.store ?? new store.TrSitesStore(opts)
        this.fetchFn = opts.fetchFn ?? this.defaultFetch
        this.srvBaseUrl = opts.srvBaseUrl?.trim() || undefined
        this.maxKeyFileBytes = opts.maxKeyFileBytes ?? 4_096
        this.fetchTimeoutMs = opts.fetchTimeoutMs ?? 8_000
        this.keyFiles = new Map<string, MemKeyFile>()
    }

    private workflowContext(): workflows.WorkflowContext {
        return {
            store: this.store,
            srvBaseUrl: this.srvBaseUrl,
            keyFiles: this.keyFiles,
            siteToOrig: site => this.siteToOrig(site),
            mkSiteKey: origin => this.mkSiteKey(origin),
            mkDlUrl: args => this.mkDlUrl(args),
            pruneKeyFiles: now => this.pruneKeyFiles(now),
            fetchKeyFile: url => this.fetchKeyFile(url)
        }
    }

    private originContext(): origins.OriginContext {
        return {
            store: this.store,
            safeDecode: value => this.safeDecode(value),
            hasScheme: value => this.hasScheme(value),
            mkRouteSite: origin => this.mkRouteSite(origin)
        }
    }

    private networkContext(): network.NetworkContext {
        return {
            fetchFn: this.fetchFn,
            fetchTimeoutMs: this.fetchTimeoutMs,
            maxKeyFileBytes: this.maxKeyFileBytes,
            assertKeyFileLen: value => this.assertKeyFileLen(value),
            assertKeyFileTxtLen: value => this.assertKeyFileTxtLen(value)
        }
    }

    public async reg(args: RegSiteArgs): Promise<RegSiteRes> {
        return await workflows.regSite(this.workflowContext(), args)
    }

    public key(args: KeyFileArgs): KeyFileRes {
        return workflows.getKeyFile(this.workflowContext(), args)
    }

    public async chk(args: ChkSiteArgs): Promise<ChkSiteRes> {
        return await workflows.checkSite(this.workflowContext(), args)
    }

    public async isTrst(origin: string): Promise<boolean> {
        return await this.store.isTrst(origin)
    }

    public normOrig(origin: string): string {
        return this.store.normOrig(origin)
    }

    public mkSiteKey(origin: string): string {
        return origins.mkSiteKey(this.originContext(), origin)
    }

    public readSiteParam(site: unknown): string {
        return origins.readSiteParam(this.originContext(), site)
    }

    public siteToOrig(site: string): string {
        return origins.siteToOrig(this.originContext(), site)
    }

    private safeDecode(value: string): string {
        return origins.safeDecode(this.originContext(), value)
    }

    private hasScheme(value: string): boolean {
        return origins.hasScheme(this.originContext(), value)
    }

    private mkRouteSite(origin: string): string {
        return origins.mkRouteSite(this.originContext(), origin)
    }

    private mkDlUrl(args: { srvBaseUrl: string; origin: string }): string {
        return origins.mkDlUrl(this.originContext(), args)
    }

    private async fetchKeyFile(url: string): Promise<string> {
        return await network.fetchKeyFile(this.networkContext(), url)
    }

    private assertKeyFileLen(value: string | null): void {
        network.assertKeyFileLen(this.networkContext(), value)
    }

    private assertKeyFileTxtLen(value: string): void {
        network.assertKeyFileTxtLen(this.networkContext(), value)
    }

    private pruneKeyFiles(now: Uts): void {
        workflows.pruneKeyFiles(this.keyFiles, now)
    }

    private async defaultFetch(url: string, init?: { signal?: AbortSignal }): ReturnType<FetchLike> {
        return await network.defaultFetch(url, init)
    }
}
