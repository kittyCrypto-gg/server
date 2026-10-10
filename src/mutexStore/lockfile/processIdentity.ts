import { promises as fs } from "fs"
import type { NodeErrorWithCode } from "./types"

export const processStartIdentity = async (pid: number): Promise<string | null> => {
    try {
        const raw = await fs.readFile(`/proc/${pid}/stat`, { encoding: 'utf8' })
        const close = raw.lastIndexOf(')')
        if (close < 0) return null
        const fields = raw.slice(close + 1).trim().split(/\s+/u)
        const start = fields[19]
        return start === undefined || start.length === 0 ? null : start
    } catch (err: unknown) {
        const code = (err as NodeErrorWithCode).code
        if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') return null
        throw err
    }
}

export const linuxBootId = async (): Promise<string | null> => {
    try {
        const value = (await fs.readFile('/proc/sys/kernel/random/boot_id', { encoding: 'utf8' })).trim()
        return value.length === 0 ? null : value
    } catch (err: unknown) {
        const code = (err as NodeErrorWithCode).code
        if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') return null
        throw err
    }
}

export const processIsAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0)
        return true
    } catch (err: unknown) {
        const code = (err as NodeErrorWithCode).code
        if (code === 'ESRCH') return false
        if (code === 'EPERM') return true
        return true
    }
}

