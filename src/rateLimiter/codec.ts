import * as protobuf from "protobufjs";
import type { IConversionOptions } from "protobufjs";
import type { ProtoBuffCodec } from "../mutexPBstore";
import { createVerifiedProtoCodec } from "../protobufCodec";
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

export const rateLimiterProtoCodec: ProtoBuffCodec<limState> = createVerifiedProtoCodec<limState>(
    rateLimiterMessageType,
    rateLimiterProtoConversionOptions,
    "Rate limiter"
);
