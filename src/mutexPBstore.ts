import { promises as fs } from 'fs'
import type { IConversionOptions, Type } from 'protobufjs'
import { MutexFileStore } from './mutexStore'

type CorruptProtoBuffStoreArgs = {
    filePath: string
    raw: Buffer
    backupPath: string
}

export type ProtoBuffCodec<T> = {
    encode: (value: T) => Buffer | Uint8Array
    decode: (raw: Buffer) => T
}

export type MutexProtoBuffStoreOptions<T> = {
    filePath: string
    initialValue: () => T
    lockTimeoutMs?: number
    lockRetryDelayMs?: number
    onCorrupt?: (args: CorruptProtoBuffStoreArgs) => void
    codec: ProtoBuffCodec<T>
}

export type ProtoBuffObjectCodecOptions<T extends Record<string, unknown>> = {
    messageType: Type
    conversionOptions?: IConversionOptions
    validate?: boolean
}

export class ProtoBuffObjectCodec<T extends Record<string, unknown>> implements ProtoBuffCodec<T> {
    private readonly messageType: Type
    private readonly conversionOptions: IConversionOptions
    private readonly validateBeforeWrite: boolean

    public constructor(options: ProtoBuffObjectCodecOptions<T>) {
        this.messageType = options.messageType
        this.conversionOptions = options.conversionOptions ?? {
            longs: String,
            enums: String
        }
        this.validateBeforeWrite = options.validate ?? true
    }

    public encode(value: T): Buffer {
        this.assertWritable(value)

        const message = this.messageType.fromObject(value)
        const encoded = this.messageType.encode(message).finish()

        return Buffer.from(encoded)
    }

    public decode(raw: Buffer): T {
        const message = this.messageType.decode(raw)
        const plainObject = this.messageType.toObject(message, this.conversionOptions)

        return plainObject as T
    }

    private assertWritable(value: T): void {
        if (!this.validateBeforeWrite) return

        const validationError = this.messageType.verify(value)

        if (validationError === null) return

        throw new Error(`MutexProtoBuffStore cannot encode invalid protobuf payload: ${validationError}`)
    }
}

export class MutexProtoBuffStore<T> extends MutexFileStore<T, Buffer> {
    private readonly codec: ProtoBuffCodec<T>

    public constructor(options: MutexProtoBuffStoreOptions<T>) {
        super(options)

        this.codec = options.codec
    }

    protected serialize(value: T): Buffer {
        return Buffer.from(this.codec.encode(value))
    }

    protected deserialize(raw: Buffer): T | null {
        try {
            return this.codec.decode(raw)
        } catch {
            return null
        }
    }

    protected async readExistingFile(filePath: string): Promise<Buffer> {
        return await fs.readFile(filePath)
    }

    protected getTempFileExtension(): string {
        return '.pb'
    }
}