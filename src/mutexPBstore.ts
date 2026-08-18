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

export type ProtoBuffObjectCodecOptions = {
    messageType: Type
    conversionOptions?: IConversionOptions
    validate?: boolean
}

export class ProtoBuffObjectCodec<T extends Record<string, unknown>> implements ProtoBuffCodec<T> {
    private readonly messageType: Type
    private readonly conversionOptions: IConversionOptions
    private readonly validateBeforeWrite: boolean

    public constructor(options: ProtoBuffObjectCodecOptions) {
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

export class MutexProtoBuffStore<T> {
    private readonly store: MutexFileStore<T>

    public constructor(options: MutexProtoBuffStoreOptions<T>) {
        this.store = new MutexFileStore<T>({
            filePath: options.filePath,
            initialValue: options.initialValue,
            lockTimeoutMs: options.lockTimeoutMs,
            lockRetryDelayMs: options.lockRetryDelayMs,
            onCorrupt: options.onCorrupt === undefined
                ? undefined
                : ({ filePath, raw, backupPath }) => options.onCorrupt?.({
                    filePath,
                    raw,
                    backupPath
                }),
            serialize: value => Buffer.from(options.codec.encode(value)),
            parse: raw => options.codec.decode(raw)
        })
    }

    public async read(): Promise<T> {
        return await this.store.read()
    }

    public async update(mutator: (value: T) => T | Promise<T>): Promise<T> {
        return await this.store.update(mutator)
    }

    public async write(value: T): Promise<T> {
        return await this.store.update(() => value)
    }

    public async exists(): Promise<boolean> {
        try {
            await fs.access(this.store.filePath)
            return true
        } catch {
            return false
        }
    }
}
