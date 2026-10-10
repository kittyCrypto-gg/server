import * as protobuf from "protobufjs";
import type { IConversionOptions } from "protobufjs";
import type { ProtoBuffCodec } from "../mutexPBstore";
import type { limState } from "./types";

const rateLimiterProtoSchema = `
syntax = "proto3";

message StoredRateLimitBucket {
    int64 resetAt = 1;
    uint32 count = 2;
}

message LimState {
    map<string, StoredRateLimitBucket> buckets = 1;
}
`;

const rateLimiterProtoRoot = protobuf.parse(rateLimiterProtoSchema).root;
const rateLimiterMessageType = rateLimiterProtoRoot.lookupType("LimState");

const rateLimiterProtoConversionOptions: IConversionOptions = {
    longs: Number,
    enums: String,
    defaults: true,
    arrays: true,
    objects: true
};

export const rateLimiterProtoCodec: ProtoBuffCodec<limState> = {
    encode: (value: limState): Buffer => {
        const validationError = rateLimiterMessageType.verify(value);

        if (validationError !== null) {
            throw new Error(`Rate limiter cannot encode invalid protobuf payload: ${validationError}`);
        }

        const message = rateLimiterMessageType.fromObject(value);
        const encoded = rateLimiterMessageType.encode(message).finish();

        return Buffer.from(encoded);
    },

    decode: (raw: Buffer): limState => {
        const message = rateLimiterMessageType.decode(raw);
        const plainObject = rateLimiterMessageType.toObject(message, rateLimiterProtoConversionOptions);

        return plainObject as limState;
    }
};
