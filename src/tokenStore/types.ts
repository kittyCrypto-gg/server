export type TokenMeta = {
    expiresAtMs: number;
};

export type TokenStoreJson = {
    version: 1;
    tokens: Record<string, { expiresAt: string }>;
};

export type SessionTokenStoreOpts = {
    filePath?: string;
    ttlMs?: number;
    saveDebounceMs?: number;
    cleanupIntervalMs?: number;
};

export type SessionTokenSink = (tokens: Set<string>) => void;

export type TokenStorePb = {
    version: 1;
    tokens: Record<string, TokenMeta>;
};

export type TokenStorePaths = {
    protoBuffFilePath: string;
    legacyJsonFilePath: string;
};
