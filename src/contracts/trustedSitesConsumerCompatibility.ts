import { TrSitesStore, type TrSitesOpts, type TrSiteRec, type PendSiteChal,
    type MkChalArgs, type MkChalRes, type VrfChalArgs, type VrfChalRes
} from "../trustedSitesStore"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T
type Ctor = Assert<Equal<ConstructorParameters<typeof TrSitesStore>, [opts?: TrSitesOpts]>>
type Make = Assert<Equal<Parameters<TrSitesStore["mkChal"]>, [args: MkChalArgs]>>
type MakeResult = Assert<Equal<ReturnType<TrSitesStore["mkChal"]>, Promise<MkChalRes>>>
type Verify = Assert<Equal<ReturnType<TrSitesStore["vrfChal"]>, Promise<VrfChalRes>>>
type IsTrusted = Assert<Equal<ReturnType<TrSitesStore["isTrst"]>, Promise<boolean>>>
type GetSite = Assert<Equal<ReturnType<TrSitesStore["getSite"]>, Promise<TrSiteRec | undefined>>>
type ListSites = Assert<Equal<ReturnType<TrSitesStore["listSites"]>, Promise<TrSiteRec[]>>>
type ListChallenges = Assert<Equal<ReturnType<TrSitesStore["listChals"]>, Promise<PendSiteChal[]>>>
type DeleteChallenge = Assert<Equal<ReturnType<TrSitesStore["delChal"]>, Promise<boolean>>>
type Revoke = Assert<Equal<ReturnType<TrSitesStore["revSite"]>, Promise<boolean>>>
export function existingConsumer(options: TrSitesOpts, origin: string): Promise<boolean> {
    const store = new TrSitesStore(options)
    void store.mkChal({ origin })
    void store.listChals()
    void store.vrfChal({ origin, keyFileText: "" })
    void store.mkVrfUrl(origin)
    void store.mkKeyFile(origin, "token")
    void store.hashKeyFile("text")
    void store.getSite(origin)
    void store.listSites()
    void store.revSite(origin)
    void store.delChal(origin)
    return store.isTrst(origin)
}
export type TrustedSitesConsumerContract =
    Ctor | Make | MakeResult | Verify | IsTrusted | GetSite |
    ListSites | ListChallenges | DeleteChallenge | Revoke
