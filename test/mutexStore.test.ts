import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
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

test('independent store instances serialise updates through the lockfile', async () => {
    const dir = await root()
    const file = join(dir, 'state.json')
    const a = new MutexJsonStore<{ count: number }>({
        filePath: file,
        initialValue: () => ({ count: 0 }),
    })
    const b = new MutexJsonStore<{ count: number }>({
        filePath: file,
        initialValue: () => ({ count: 0 }),
    })

    await Promise.all(Array.from({ length: 20 }, async (_, index) => {
        const store = index % 2 === 0 ? a : b
        await store.update((current) => ({ count: current.count + 1 }))
    }))

    expect(await a.read()).toEqual({ count: 20 })
})
