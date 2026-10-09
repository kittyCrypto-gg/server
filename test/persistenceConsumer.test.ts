import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'protobufjs'
import { MutexJsonStore, MutexFileStore } from '../src/mutexStore'
import { MutexProtoBuffStore, type ProtoBuffCodec } from '../src/mutexPBstore'
import { MutexProtoBuffStore as ConsumerStore, ProtoBuffObjectCodec as ConsumerCodec } from '@kittycrypto/server'
import * as deepFileStore from '../src/mutexStore'
import * as root from '../src/index'

const temporary: string[] = []
afterEach(async () => {
    await Promise.all(temporary.splice(0).map(async dir => rm(dir, { recursive: true, force: true })))
})
const dir = async (): Promise<string> => {
    const folder = await mkdtemp(join(tmpdir(), 'mutex-consumer-'))
    temporary.push(folder)
    return folder
}
type Value = { count: number }
const type = parse('syntax = "proto3"; message State { uint32 count = 1; }').root.lookupType('State')
const codec: ProtoBuffCodec<Value> = {
    encode: value => Buffer.from(type.encode(type.create(value)).finish()),
    decode: raw => type.decode(raw).toJSON() as Value,
}

test('direct file-store and package-root protobuf exports remain stable', () => {
    expect(typeof MutexFileStore).toBe('function')
    expect(typeof MutexJsonStore).toBe('function')
    expect(root.MutexProtoBuffStore).toBe(MutexProtoBuffStore)
    expect(ConsumerStore).toBe(MutexProtoBuffStore)
    expect(ConsumerCodec).toBe(root.ProtoBuffObjectCodec)
    expect(Object.keys(deepFileStore).sort()).toEqual(['MutexFileStore', 'MutexJsonStore'])
    expect(Object.keys(root).sort()).toEqual(['MutexProtoBuffStore', 'ProtoBuffObjectCodec', 'Server'])
    expect(typeof root.ProtoBuffObjectCodec).toBe('function')
    expect(typeof root.Server).toBe('function')
})

test('JSON store preserves bytes, newline, permissions and update semantics', async () => {
    const folder = await dir()
    const file = join(folder, 'nested', 'state.json')
    const store = new MutexJsonStore<Value>({ filePath: file, initialValue: () => ({ count: 2 }) })
    expect(await store.read()).toEqual({ count: 2 })
    expect(await readFile(file, 'utf8')).toBe('{\n  "count": 2\n}\n')
    expect(await store.update(cur => ({ count: cur.count + 3 }))).toEqual({ count: 5 })
    expect(await readFile(file, 'utf8')).toBe('{\n  "count": 5\n}\n')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await stat(join(folder, 'nested'))).mode & 0o777).toBe(0o700)
    expect((await readdir(join(folder, 'nested'))).some(name => name.endsWith('.lock'))).toBe(false)
})

test('original protobuf store reads and writes canonical wire bytes', async () => {
    const folder = await dir()
    const file = join(folder, 'state.pb')
    const store = new MutexProtoBuffStore<Value>({ filePath: file, initialValue: () => ({ count: 4 }), codec })
    expect(await store.read()).toEqual({ count: 4 })
    expect(await readFile(file)).toEqual(Buffer.from(type.encode(type.create({ count: 4 })).finish()))
    expect(await store.update(cur => ({ count: cur.count + 1 }))).toEqual({ count: 5 })
    expect(await readFile(file)).toEqual(Buffer.from(type.encode(type.create({ count: 5 })).finish()))
    const second = new MutexProtoBuffStore<Value>({ filePath: file, initialValue: () => ({ count: 0 }), codec })
    expect(await second.read()).toEqual({ count: 5 })
})

test('protobuf corruption policy throws and preserves original bytes with a backup', async () => {
    const folder = await dir()
    const file = join(folder, 'critical.pb')
    const corrupt = Buffer.from([255,255,255])
    await writeFile(file, corrupt)
    const backups: string[] = []
    const store = new MutexProtoBuffStore<Value>({
        filePath: file,
        initialValue: () => ({ count: 0 }),
        codec,
        corruptionPolicy: 'throw',
        onCorrupt: event => { backups.push(event.backupPath) },
    })
    await expect(store.read()).rejects.toThrow('detected corrupt state')
    expect(await readFile(file)).toEqual(corrupt)
    expect(backups).toHaveLength(1)
    expect(await readFile(backups[0]!)).toEqual(corrupt)
    expect((await stat(backups[0]!)).mode & 0o777).toBe(0o600)
})

test('separate protobuf instances keep cross-instance updates serialised', async () => {
    const folder = await dir()
    const file = join(folder, 'shared.pb')
    const a = new MutexProtoBuffStore<Value>({ filePath: file, initialValue: () => ({ count: 0 }), codec, lockRetryDelayMs: 2 })
    const b = new MutexProtoBuffStore<Value>({ filePath: file, initialValue: () => ({ count: 0 }), codec, lockRetryDelayMs: 2 })
    await Promise.all(Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? a : b).update(cur => ({ count: cur.count + 1 }))
    ))
    expect(await a.read()).toEqual({ count: 12 })
})


test('FelineBot-style object codec preserves message options, bytes and persisted updates', async () => {
    type Archive = Record<string, unknown> & {
        owner: string
        seedStage: number
        candles: string[]
    }
    const folder = await dir()
    const file = join(folder, 'feline.pb')
    const messageType = parse('syntax = "proto3"; message Archive { string owner = 1; uint32 seedStage = 2; repeated string candles = 3; }').root.lookupType('Archive')
    const objectCodec = new ConsumerCodec<Archive>({
        messageType,
        conversionOptions: { defaults: true, arrays: true }
    })
    const initial: Archive = { owner: '', seedStage: 0, candles: [] }
    const state = new ConsumerStore<Archive>({
        filePath: file,
        initialValue: () => initial,
        codec: objectCodec,
        onCorrupt: ({ backupPath }) => { void backupPath }
    })
    expect(await state.read()).toEqual(initial)
    const changed = await state.update(current => ({
        ...current, owner: 'worker-a', seedStage: 2, candles: [...current.candles, 'one', 'two']
    }))
    expect(changed).toEqual({ owner: 'worker-a', seedStage: 2, candles: ['one', 'two'] })
    const raw = await readFile(file)
    const wire = messageType.decode(raw)
    expect(messageType.toObject(wire, { defaults: true, arrays: true })).toEqual(changed)
    const reopened = new ConsumerStore<Archive>({
        filePath: file, initialValue: () => initial, codec: objectCodec
    })
    expect(await reopened.read()).toEqual(changed)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(() => objectCodec.encode({ ...changed, seedStage: 'invalid' } as unknown as Archive))
        .toThrow('cannot encode invalid protobuf payload')
})
