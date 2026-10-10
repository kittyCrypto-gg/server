import * as protobuf from "protobufjs";
import type { IConversionOptions } from "protobufjs";
import type { ProtoBuffCodec } from "../mutexPBstore";
import { createVerifiedProtoCodec } from "../protobufCodec";
import type { TokenStorePb } from "./types";

const sessionTokensProtoSchema = `
syntax = "proto3";

message TokenMeta {
    int64 expiresAtMs = 1;
}

message TokenStorePb {
    uint32 version = 1;
    map<string, TokenMeta> tokens = 2;
}
`;

const sessionTokensProtoRoot = protobuf.parse(sessionTokensProtoSchema).root;
const sessionTokensMessageType = sessionTokensProtoRoot.lookupType("TokenStorePb");

const sessionTokensProtoConversionOptions: IConversionOptions = {
    longs: Number,
    enums: String,
    defaults: true,
    arrays: true,
    objects: true
};

export const sessionTokensProtoCodec: ProtoBuffCodec<TokenStorePb> = createVerifiedProtoCodec<TokenStorePb>(
    sessionTokensMessageType,
    sessionTokensProtoConversionOptions,
    "Session token store"
);
