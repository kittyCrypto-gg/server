export class AsyncMutex {
    private chain: Promise<void> = Promise.resolve()

    public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        const previous = this.chain

        let release: (() => void) | undefined
        this.chain = new Promise<void>((resolve) => {
            release = resolve
        })

        await previous

        try {
            return await fn()
        } finally {
            release!()
        }
    }
}
