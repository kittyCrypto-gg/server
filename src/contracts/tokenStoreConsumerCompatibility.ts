import { tokenStore, type SessionTokenSink, type SessionTokenStoreOpts, type TokenMeta, type TokenStoreJson } from "../tokenStore";
import type Server from "../baseServer";

/**
 * Compile-time checks for downstream consumers of the historical deep import.
 * Do not expose this contract or new types from src/index.ts.
 */
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
                   (<T>() => T extends B ? 1 : 2) ? true : false;
type ConsumerConstructor = new (
    server: Server,
    tokens: Set<string>,
    notify: SessionTokenSink,
    options?: SessionTokenStoreOpts
) => tokenStore;
type OriginalConstructor = Assert<typeof tokenStore extends ConsumerConstructor ? true : false>;
type OriginalInit = Assert<Equal<ReturnType<tokenStore["init"]>, void>>;
type OriginalReady = Assert<Equal<ReturnType<tokenStore["waitUntilReady"]>, Promise<void>>>;
type OriginalAsyncValidation = Assert<Equal<ReturnType<tokenStore["tokenExistsAndValidAsync"]>, Promise<boolean>>>;
type OriginalValidation = Assert<Equal<ReturnType<tokenStore["tokenExistsAndValid"]>, boolean>>;
type OriginalExpiry = Assert<Equal<ReturnType<tokenStore["getExpiryMs"]>, number | null>>;
type OriginalTokens = Assert<Equal<Parameters<tokenStore["touchToken"]>, [string]>>;
type OriginalDrop = Assert<Equal<Parameters<tokenStore["dropToken"]>, [string]>>;
type OriginalMeta = Assert<Equal<TokenMeta, { expiresAtMs: number }>>;
type OriginalJson = Assert<Equal<TokenStoreJson["version"], 1>>;

export type TokenStoreConsumerCompatibility =
    | OriginalConstructor | OriginalInit | OriginalReady | OriginalAsyncValidation
    | OriginalValidation | OriginalExpiry | OriginalTokens | OriginalDrop
    | OriginalMeta | OriginalJson;
