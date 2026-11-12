import * as protobuf from "protobufjs"
import type { IConversionOptions } from "protobufjs"
import type { ProtoBuffCodec } from "../mutexPBstore"
import type { TrSitesState } from "./types"

const pbSchema = `
syntax = "proto3";

message PendingTrustedSiteChallenge {
    string origin = 1;
    string challengeTokenHash = 2;
    int64 createdAt = 3;
    int64 expiresAt = 4;
    string verificationPath = 5;
    string requesterKey = 6;
    string keyFileSha256 = 7;
}

message TrustedSiteRecord {
    string origin = 1;
    int64 verifiedAt = 2;
    string verificationPath = 3;
    int64 lastChallengeAt = 4;
}

message TrustedSitesState {
    map<string, PendingTrustedSiteChallenge> pendingChallenges = 1;
    map<string, TrustedSiteRecord> trustedSites = 2;
    int64 updatedAt = 3;
}
`

const pbRoot = protobuf.parse(pbSchema).root
const pbType = pbRoot.lookupType("TrustedSitesState")

const pbConv: IConversionOptions = {
    longs: Number,
    enums: String,
    defaults: true,
    arrays: true,
    objects: true
}

export const pbCodec: ProtoBuffCodec<TrSitesState> = {
    encode: (val: TrSitesState): Buffer => {
        const err = pbType.verify(val)

        if (err !== null) {
            throw new Error(`TrSitesStore cannot encode invalid protobuf payload: ${err}`)
        }

        const msg = pbType.fromObject(val)
        const enc = pbType.encode(msg).finish()

        return Buffer.from(enc)
    },

    decode: (raw: Buffer): TrSitesState => {
        const msg = pbType.decode(raw)
        const obj = pbType.toObject(msg, pbConv)

        return obj as TrSitesState
    }
}
