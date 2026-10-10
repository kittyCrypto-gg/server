import type { IConversionOptions, Type } from "protobufjs";
import type { ProtoBuffCodec } from "./mutexPBstore";

/**
 * Common verified protobuf encoder/decoder. Callers supply their original
 * message Type, conversion settings and exact validation error prefix.
 */
export function createVerifiedProtoCodec<T extends object>(
    messageType: Type,
    conversionOptions: IConversionOptions,
    errorPrefix: string,
): ProtoBuffCodec<T> {
    return {
        encode(value: T): Buffer {
            const error = messageType.verify(value as Record<string, unknown>);
            if (error !== null) {
                throw new Error(`${errorPrefix} cannot encode invalid protobuf payload: ${error}`);
            }
            const message = messageType.fromObject(value as Record<string, unknown>);
            return Buffer.from(messageType.encode(message).finish());
        },
        decode(raw: Buffer): T {
            const message = messageType.decode(raw);
            return messageType.toObject(message, conversionOptions) as T;
        }
    };
}
