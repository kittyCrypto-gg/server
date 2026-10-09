import * as protobuf from "protobufjs";
import type { IConversionOptions } from "protobufjs";
import type { ProtoBuffCodec } from "../mutexPBstore";
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

export const sessionTokensProtoCodec: ProtoBuffCodec<TokenStorePb> = {
    encode: (value: TokenStorePb): Buffer => {
        const validationError = sessionTokensMessageType.verify(value);

        if (validationError !== null) {
            throw new Error(`Session token store cannot encode invalid protobuf payload: ${validationError}`);
        }

        const message = sessionTokensMessageType.fromObject(value);
        const encoded = sessionTokensMessageType.encode(message).finish();

        return Buffer.from(encoded);
    },

    decode: (raw: Buffer): TokenStorePb => {
        const message = sessionTokensMessageType.decode(raw);
        const plainObject = sessionTokensMessageType.toObject(message, sessionTokensProtoConversionOptions);

        return plainObject as TokenStorePb;
    }
};
