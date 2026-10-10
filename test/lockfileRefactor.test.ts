import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import type { Stats } from 'node:fs'
import { Lockfile } from '../src/mutexStore/lockfile'
import { ownedMetadata } from '../src/mutexStore/lockfile/metadata'
import { sameLock, isStaleLock, readExistingLock } from '../src/mutexStore/lockfile/inspection'
import type { ExistingLock, OwnedLockMetadata } from '../src/mutexStore/lockfile/types'

const directories: string[] = []
afterEach(async () => {
    await Promise.all(directories.splice(0).map(async dir => rm(dir, { recursive: true, force: true })))
})
const temporary = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'lockfile-refactor-'))
    directories.push(dir)
    return dir
}
const metadata = (changes: Partial<OwnedLockMetadata> = {}): OwnedLockMetadata => ({
    version: 1,
    pid: process.pid,
    host: hostname(),
    bootId: null,
    processStart: null,
    createdAt: Date.now(),
    token: 'owner-token',
    ...changes,
})
const parsed = (meta: OwnedLockMetadata | null, statistics: Stats, raw = ''): ExistingLock => ({
    metadata: meta, legacyPid: null, legacyCreatedAt: null, raw, stat: statistics,
})

test('owner metadata parser retains original validation and ignores unknown fields', () => {
    const owner = metadata()
    expect(ownedMetadata(owner)).toEqual(owner)
    expect(ownedMetadata({ ...owner, extra: 1 })).toEqual(owner)
    expect(ownedMetadata(null)).toBeNull()
    expect(ownedMetadata({ ...owner, token: '' })).toBeNull()
    expect(ownedMetadata({ ...owner, pid: -1 })).toBeNull()
    expect(ownedMetadata({ ...owner, version: 2 })).toBeNull()
    expect(ownedMetadata({ ...owner, bootId: 12 })).toBeNull()
    expect(ownedMetadata({ ...owner, processStart: 12 })).toBeNull()
})

test('legacy and owned records retain parsing and enforced file mode', async () => {
    const dir = await temporary()
    const file = join(dir, 'lock')
    const owner = metadata()
    await writeFile(file, JSON.stringify(owner))
    const modern = await readExistingLock(file, 0o600)
    expect(modern?.metadata).toEqual(owner)
    expect(modern?.legacyPid).toBeNull()
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    await writeFile(file, '999999\n2026-10-10T01:02:03.000Z\n')
    const legacy = await readExistingLock(file, 0o600)
    expect(legacy?.metadata).toBeNull()
    expect(legacy?.legacyPid).toBe(999999)
    expect(legacy?.legacyCreatedAt).toBe(Date.parse('2026-10-10T01:02:03.000Z'))
    expect(await readExistingLock(join(dir, 'missing'), 0o600)).toBeNull()
})

test('same-lock matching checks inode, owner token and legacy raw content', async () => {
    const dir = await temporary()
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await writeFile(a, 'shared')
    await writeFile(b, 'shared')
    const statA = await stat(a)
    const statB = await stat(b)
    expect(sameLock(parsed(metadata(), statA), parsed(metadata(), statB))).toBe(false)
    expect(sameLock(parsed(metadata(), statA), parsed(metadata(), statA))).toBe(true)
    expect(sameLock(parsed(metadata(), statA), parsed(metadata({ token: 'other' }), statA))).toBe(false)
    expect(sameLock(parsed(null, statA, 'legacy'), parsed(null, statA, 'legacy'))).toBe(true)
    expect(sameLock(parsed(null, statA, 'legacy'), parsed(null, statA, 'changed'))).toBe(false)
})

test('stale checks preserve foreign host, boot ID, live PID and dead PID behaviour', async () => {
    const dir = await temporary()
    const file = join(dir, 'lock')
    await writeFile(file, '{}')
    const statistics = await stat(file)
    const ctx = { host: hostname(), bootId: Promise.resolve('current-boot'), bootStartedAt: Date.now() - 30_000 }
    expect(await isStaleLock(ctx, parsed(metadata({ host: 'foreign-host' }), statistics))).toBe(false)
    expect(await isStaleLock(ctx, parsed(metadata({ bootId: 'previous-boot' }), statistics))).toBe(true)
    expect(await isStaleLock(ctx, parsed(metadata(), statistics))).toBe(false)
    expect(await isStaleLock(ctx, parsed(metadata({ pid: 999999 }), statistics))).toBe(true)
    expect(await isStaleLock(ctx, { ...parsed(null, statistics), legacyPid: process.pid })).toBe(false)
})

test('release never deletes another lock owner after token replacement', async () => {
    const dir = await temporary()
    const target = join(dir, 'state.json')
    const lock = new Lockfile(target, 500, 5, 0o600)
    const release = await lock.acquire()
    const file = target + '.lock'
    const original = JSON.parse(await readFile(file, 'utf8')) as OwnedLockMetadata
    expect(original.token).toBeTruthy()
    expect(original.pid).toBe(process.pid)
    await writeFile(file, JSON.stringify({ ...original, token: 'replacement-owner' }))
    await release()
    const newer = JSON.parse(await readFile(file, 'utf8')) as OwnedLockMetadata
    expect(newer.token).toBe('replacement-owner')
})

test('normal acquire/release uses owner records without leaving the lock held', async () => {
    const dir = await temporary()
    const target = join(dir, 'data.json')
    const lock = new Lockfile(target, 500, 5, 0o600)
    const release = await lock.acquire()
    expect((await readFile(target + '.lock', 'utf8')).includes('"version":1')).toBe(true)
    await release()
    expect(await readExistingLock(target + '.lock', 0o600)).toBeNull()
})
