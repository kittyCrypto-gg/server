import { promises as fs } from 'node:fs'
import { MutexJsonStore, MutexFileStore, type CorruptionPolicy } from '../mutexStore'
import { MutexProtoBuffStore as DeepProtoStore, ProtoBuffObjectCodec as DeepObjectCodec, type ProtoBuffCodec as DeepCodec } from '../mutexPBstore'
import { MutexProtoBuffStore, ProtoBuffObjectCodec, type ProtoBuffCodec, type MutexProtoBuffStoreOptions, type ProtoBuffObjectCodecOptions } from '../index'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T
type PreservedStore = Assert<Equal<typeof DeepProtoStore, typeof MutexProtoBuffStore>>
type PreservedCodec = Assert<Equal<typeof DeepObjectCodec, typeof ProtoBuffObjectCodec>>
type PreservedCodecShape = Assert<Equal<ProtoBuffCodec<{ value: number }>, DeepCodec<{ value: number }>>>
type PreservedPolicy = Assert<Equal<CorruptionPolicy, 'recover' | 'throw'>>

type State = { count: number }
export class ExternalStoreSubclass extends MutexFileStore<State, Buffer> {
    protected override serialize(state: State): Buffer { return Buffer.from(String(state.count)) }
    protected override deserialize(raw: Buffer): State | null {
        const count = Number(raw.toString())
        return Number.isSafeInteger(count) ? { count } : null
    }
    protected override async readExistingFile(filePath: string): Promise<Buffer> { return await fs.readFile(filePath) }
    protected override getTempFileExtension(): string { return '.buffer' }
    public async inspectHooks(): Promise<void> {
        void this.filePath
        void this.dirPath
        void this.initialValue
        void this.mutex.runExclusive
        void this.lockfile.acquire
        void this.onCorrupt
        void this.fileMode
        void this.dirMode
        await this.ensureDirectory()
        await this.readFileOrNull(this.filePath)
        await this.withStoreLock(async () => {})
        void this.createTempFileName()
        void this.createCorruptBackupPath()
    }
}
export function existingConsumers(filePath: string, codec: ProtoBuffCodec<State>) {
    const json = new MutexJsonStore<State>({
        filePath: filePath + '.json', initialValue: () => ({ count: 0 }), corruptionPolicy: 'recover',
        fileMode: 0o600, dirMode: 0o700, jsonIndent: 2,
    })
    const options: MutexProtoBuffStoreOptions<State> = {
        filePath, initialValue: () => ({ count: 0 }), codec, corruptionPolicy: 'throw',
        lockTimeoutMs: 5000, lockRetryDelayMs: 25, fileMode: 0o600, dirMode: 0o700,
        onCorrupt: ({ raw, filePath, backupPath }) => { void raw; void filePath; void backupPath },
    }
    const proto = new MutexProtoBuffStore<State>(options)
    void ({} as ProtoBuffObjectCodecOptions)
    return { json, proto }
}
export type Compatibility = PreservedStore | PreservedCodec | PreservedCodecShape | PreservedPolicy
