import type { RenderConfig } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://kittycrypto.gg",
  "https://kittycrow.dev"
];

export function getAllowedOrigins(config: RenderConfig): Set<string> {
  const origins = config.allowedOrigins?.length
    ? config.allowedOrigins
    : DEFAULT_ALLOWED_ORIGINS;

  return new Set(
    origins.map((origin) => {
      return new URL(origin).origin;
    })
  );
}

export function getTimeout(config: RenderConfig): number {
  return config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

export function getExecutablePath(config: RenderConfig): string {
  const fromConfig = config.executablePath?.trim();

  if (fromConfig) {
    return fromConfig;
  }

  const fromEnv =
    process.env.CHROME_PATH?.trim() ||
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

  if (fromEnv) {
    return fromEnv;
  }

  throw new Error(
    "Missing Chrome executable path. Set CHROME_PATH or pass executablePath in render config."
  );
}

export function getRequestRenderConfig(config: RenderConfig): RenderConfig {
  return {
    ...config,
    allowedOrigins: config.allowedOrigins?.length
      ? config.allowedOrigins
      : DEFAULT_ALLOWED_ORIGINS,
    executablePath: config.executablePath ?? process.env.CHROME_PATH
  };
}
