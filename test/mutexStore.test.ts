import { afterEach, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { hostname, tmpdir } from 'os'
import { join } from 'path'
import { MutexJsonStore } from '../src/mutexStore'

const roots: string[] = []

afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

class CountingStore extends MutexJsonStore<{ count: number }> {
    public writes = 0

    protected override serialize(value: { count: number }): string {
        this.writes += 1
        return super.serialize(value)
    }
}

const root = async (): Promise<string> => {
    const value = await mkdtemp(join(tmpdir(), 'mutex-store-'))
    roots.push(value)
    return value
}

const storeAt = (file: string, lockTimeoutMs = 5_000): MutexJsonStore<{ count: number }> =>
    new MutexJsonStore<{ count: number }>({
        filePath: file,
        initialValue: () => ({ count: 0 }),
        lockTimeoutMs,
        lockRetryDelayMs: 5,
    })

const permissions = async (file: string): Promise<number> => (await stat(file)).mode & 0o777

test('first update persists only the final value', async () => {
    const dir = await root()
    const file = join(dir, 'state.json')
    const store = new CountingStore({
        filePath: file,
        initialValue: () => ({ count: 0 }),
    })

    expect(await store.update((current) => ({ count: current.count + 1 }))).toEqual({ count: 1 })
    expect(store.writes).toBe(1)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ count: 1 })
})

test('read still materialises an initial store', async () => {
    const dir = await root()
    const file = join(dir, 'state.json')
    const store = new CountingStore({
        filePath: file,
        initialValue: () => ({ count: 7 }),
    })

    expect(await store.read()).toEqual({ count: 7 })
    expect(store.writes).toBe(1)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ count: 7 })
})

test('store data, lock and corruption files remain owner-only', async () => {
    const parent = await root()
    const dir = join(parent, 'private-state')
    const file = join(dir, 'state.json')
    let backupPath: string | null = null
    const store = new MutexJsonStore<{ count: number }>({
        filePath: file,
        initialValue: () => ({ count: 0 }),
        onCorrupt: value => { backupPath = value.backupPath },
    })

    let lockMode: number | null = null
    await store.update(async current => {
        lockMode = await permissions(`${file}.lock`)
        return { count: current.count + 1 }
    })

    expect(lockMode).toBe(0o600)
    expect(await permissions(file)).toBe(0o600)
    expect(await permissions(dir)).toBe(0o700)

    await chmod(file, 0o666)
    expect(await permissions(file)).toBe(0o666)
    await store.read()
    expect(await permissions(file)).toBe(0o600)

    await writeFile(file, '{broken json\n')
    await chmod(file, 0o666)
    expect(await store.read()).toEqual({ count: 0 })
    expect(backupPath).not.toBeNull()
    expect(await permissions(backupPath!)).toBe(0o600)
    expect(await permissions(file)).toBe(0o600)
})

test('security-critical stores fail closed without replacing corrupt state', async () => {
    const parent = await root()
    const dir = join(parent, 'security-state')
    const file = join(dir, 'security.json')
    await mkdir(dir, { recursive: true, mode: 0o777 })
    await chmod(dir, 0o777)
    await writeFile(file, '{this is not valid json')
    await chmod(file, 0o666)

    const store = new MutexJsonStore<{ count: number }>({
        filePath: file,
        initialValue: () => ({ count: 0 }),
        corruptionPolicy: 'throw',
    })

    await expect(store.read()).rejects.toThrow('detected corrupt state')
    expect(await readFile(file, 'utf8')).toBe('{this is not valid json')
    expect(await permissions(file)).toBe(0o600)
    expect(await permissions(dir)).toBe(0o700)

    const backups = (await readdir(dir)).filter(name => name.startsWith('security.json.corrupt.'))
    expect(backups).toHaveLength(1)
    const backup = join(dir, backups[0]!)
    expect(await readFile(backup, 'utf8')).toBe('{this is not valid json')
    expect(await permissions(backup)).toBe(0o600)
})

test('independent store instances serialise updates through the lockfile', async () => {
    const dir = await root()
    const file = join(dir, 'state.json')
    const a = storeAt(file)
    const b = storeAt(file)

    await Promise.all(Array.from({ length: 20 }, async (_, index) => {
        const store = index % 2 === 0 ? a : b
        await store.update((current) => ({ count: current.count + 1 }))
    }))

    expect(await a.read()).toEqual({ count: 20 })
})

test('dead legacy lock owner is reclaimed automatically', async () => {
    const dir = await root()
    const file = join(dir, 'state.json')
    await writeFile(`${file}.lock`, `999999\n${new Date().toISOString()}\n`)

    expect(await storeAt(file, 500).update((current) => ({ count: current.count + 1 }))).toEqual({ count: 1 })
})

test('empty legacy lock from before the current boot is reclaimed automatically', async () => {
    const dir = await root()
    const file = join(dir, 'state.json')
    const lock = `${file}.lock`
    await writeFile(lock, '')
    await utimes(lock, new Date(0), new Date(0))

    expect(await storeAt(file, 500).update((current) => ({ count: current.count + 1 }))).toEqual({ count: 1 })
})

test('live legacy lock owner is never stolen', async () => {
    const dir = await root()
    const file = join(dir, 'state.json')
    await writeFile(`${file}.lock`, `${process.pid}\n${new Date().toISOString()}\n`)

    await expect(storeAt(file, 60).update((current) => ({ count: current.count + 1 })))
        .rejects.toThrow('MutexFileStore lock timeout')
})

test('PID reuse cannot keep a dead owner lock alive on Linux', async () => {
    const dir = await root()
    const file = join(dir, 'state.json')
    await writeFile(`${file}.lock`, `${JSON.stringify({
        version: 1,
        pid: process.pid,
        host: hostname(),
        bootId: null,
        processStart: 'not-the-current-process-start',
        createdAt: Date.now(),
        token: 'stale-pid-reuse-test',
    })}\n`)

    expect(await storeAt(file, 500).update((current) => ({ count: current.count + 1 }))).toEqual({ count: 1 })
})
