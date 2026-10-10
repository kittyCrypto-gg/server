import type { limState, StoredRateLimitBucket } from "./types";


export function normaliseState(value: unknown): limState {
    if (!isRecord(value)) {
        return {
            buckets: {}
        };
    }

    const rawBuckets = isRecord(value.buckets) ? value.buckets : {};
    const buckets: Record<string, StoredRateLimitBucket> = {};

    for (const [bucketId, rawBucket] of Object.entries(rawBuckets)) {
        const bucket = normaliseBucket(rawBucket);

        if (!bucket) {
            continue;
        }

        buckets[bucketId] = bucket;
    }

    return {
        buckets
    };
}

export function normaliseBucket(value: unknown): StoredRateLimitBucket | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const resetAt = normalisePositiveInteger(value.resetAt);
    const count = normalisePositiveInteger(value.count);

    if (typeof resetAt !== "number" || typeof count !== "number") {
        return undefined;
    }

    return {
        resetAt,
        count
    };
}

export function normalisePositiveInteger(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }

    return Math.floor(value);
}

export function hasBuckets(state: limState): boolean {
    return Object.keys(state.buckets).length > 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
