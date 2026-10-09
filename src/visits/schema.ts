import * as protobuf from "protobufjs"
import type { IConversionOptions } from "protobufjs"
import type { ProtoBuffCodec } from "../mutexPBstore"
import type { VisitsModel } from "./types"

export const visitsProtoSchema = `
syntax = "proto3";

message VisitEntry {
    uint64 count = 1;
    repeated int64 timestamps = 2;
}

message VisitBucket {
    uint64 visits = 1;
    map<string, VisitEntry> ips = 2;
}

message VisitsModel {
    map<string, VisitBucket> pages = 1;
    int64 updatedAt = 2;
}
`

const visitsProtoRoot = protobuf.parse(visitsProtoSchema).root
const visitsMessageType = visitsProtoRoot.lookupType("VisitsModel")

export const visitsProtoConversionOptions: IConversionOptions = {
    longs: Number,
    enums: String,
    defaults: true,
    arrays: true,
    objects: true
}

export const visitsProtoCodec: ProtoBuffCodec<VisitsModel> = {
    encode: (value: VisitsModel): Buffer => {
        const validationError = visitsMessageType.verify(value)

        if (validationError !== null) {
            throw new Error(`VisitsStore cannot encode invalid protobuf payload: ${validationError}`)
        }

        const message = visitsMessageType.fromObject(value)
        const encoded = visitsMessageType.encode(message).finish()

        return Buffer.from(encoded)
    },

    decode: (raw: Buffer): VisitsModel => {
        const message = visitsMessageType.decode(raw)
        const plainObject = visitsMessageType.toObject(message, visitsProtoConversionOptions)

        return plainObject as VisitsModel
    }
}
