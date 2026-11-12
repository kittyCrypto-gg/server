import { tokenStore, type TokenMeta, type TokenStoreJson, type SessionTokenSink, type SessionTokenStoreOpts } from "../tokenStore";
import Server from "../baseServer";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ConstructorIsStable = Assert<Equal<ConstructorParameters<typeof tokenStore>, [
    server: Server,
    sessionTokens: Set<string>,
    onTokensChanged: (tokens: Set<string>) => void,
    opts?: SessionTokenStoreOpts
]>>;
type ReadyIsStable = Assert<Equal<ReturnType<tokenStore["waitUntilReady"]>, Promise<void>>>;
type ValidAsyncIsStable = Assert<Equal<ReturnType<tokenStore["tokenExistsAndValidAsync"]>, Promise<boolean>>>;
type ExpiresIsStable = Assert<Equal<ReturnType<tokenStore["getExpiryMs"]>, number | null>>;
type TokenMetaIsStable = Assert<Equal<TokenMeta, { expiresAtMs: number }>>;
type LegacyShapeIsStable = Assert<Equal<TokenStoreJson, { version: 1; tokens: Record<string, { expiresAt: string }> }>>;
type SinkIsStable = Assert<Equal<SessionTokenSink, (tokens: Set<string>) => void>>;

export function existingTokenConsumer(server: Server, set: Set<string>, sink: SessionTokenSink, opts: SessionTokenStoreOpts): tokenStore {
    const store = new tokenStore(server, set, sink, opts);
    store.init();
    void store.waitUntilReady();
    void store.tokenExistsAndValidAsync("token");
    store.touchToken("token");
    void store.tokenExistsAndValid("token");
    void store.getExpiryMs("token");
    store.dropToken("token");
    store.dispose();
    return store;
}
export type TokenConsumerCompatibility = ConstructorIsStable | ReadyIsStable | ValidAsyncIsStable | ExpiresIsStable | TokenMetaIsStable | LegacyShapeIsStable | SinkIsStable;
