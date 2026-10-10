import { describe, expect, test } from "bun:test";
import * as protobuf from "protobufjs";
import { sessionTokensProtoCodec } from "../src/tokenStore/schema";
import { visitsProtoCodec, visitsProtoSchema, visitsProtoConversionOptions } from "../src/visits/schema";
import { rateLimiterProtoCodec } from "../src/rateLimiter/codec";
import { pbCodec } from "../src/trustedSitesStore/schema";
import type { TokenStorePb } from "../src/tokenStore/types";
import type { VisitsModel } from "../src/visits/types";
import type { limState } from "../src/rateLimiter/types";
import type { TrSitesState } from "../src/trustedSitesStore/types";

describe("shared protobuf codec parity across all four stores", () => {
    test("token codec retains binary roundtrip and original invalid-payload error prefix", () => {
        const state: TokenStorePb = {version: 1, tokens: {abc: {expiresAtMs: 1700000000000}}};
        const raw = sessionTokensProtoCodec.encode(state);
        expect(sessionTokensProtoCodec.decode(Buffer.from(raw))).toEqual(state);
        expect(() => sessionTokensProtoCodec.encode({version: 1, tokens: "invalid"} as unknown as TokenStorePb))
            .toThrow(/^Session token store cannot encode invalid protobuf payload:/);
    });

    test("visits codec exports the original schema/options and keeps the exact binary representation", () => {
        const state: VisitsModel = {pages: {"/": {visits: 3, ips: {"127.0.0.1": {
            count: 3, timestamps: [1700000000000]
        }}}}, updatedAt: 1700000000000};
        const root = protobuf.parse(visitsProtoSchema).root;
        const type = root.lookupType("VisitsModel");
        const manual = Buffer.from(type.encode(type.fromObject(state)).finish());
        const raw = Buffer.from(visitsProtoCodec.encode(state));
        expect(raw).toEqual(manual);
        expect(visitsProtoCodec.decode(raw)).toEqual(type.toObject(type.decode(manual), visitsProtoConversionOptions));
        expect(() => visitsProtoCodec.encode({pages: "invalid", updatedAt: 1} as unknown as VisitsModel))
            .toThrow(/^VisitsStore cannot encode invalid protobuf payload:/);
    });

    test("rate limiter codec preserves reset timers, counts and validation error prefix", () => {
        const state: limState = {buckets: {test: {resetAt: 1700000000000, count: 12}}};
        const raw = Buffer.from(rateLimiterProtoCodec.encode(state));
        expect(rateLimiterProtoCodec.decode(raw)).toEqual(state);
        expect(() => rateLimiterProtoCodec.encode({buckets: "invalid"} as unknown as limState))
            .toThrow(/^Rate limiter cannot encode invalid protobuf payload:/);
    });

    test("trusted site codec preserves protobuf map shapes and its own error message", () => {
        const state: TrSitesState = {pendingChallenges: {}, trustedSites: {}, updatedAt: 1700000000000};
        const raw = Buffer.from(pbCodec.encode(state));
        expect(pbCodec.decode(raw)).toEqual(state);
        expect(() => pbCodec.encode({pendingChallenges: "invalid"} as unknown as TrSitesState))
            .toThrow(/^TrSitesStore cannot encode invalid protobuf payload:/);
    });
});
