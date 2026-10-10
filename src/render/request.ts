import type { RenderConfig, RenderJob } from "./types";
import { getAllowedOrigins } from "./config";

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
export function assertAllowedTarget(url: URL, config: RenderConfig): void {
  const allowedOrigins = getAllowedOrigins(config);

  if (allowedOrigins.has(url.origin)) {
    return;
  }

  throw new InputError(`Target origin is not allowed: ${url.origin}`);
}

function parseRenderJob(value: unknown): RenderJob {
  if (typeof value !== "object" || value === null) {
    throw new InputError("Invalid render payload.");
  }

  const payload = value as {
    url?: unknown;
    waitForSelector?: unknown;
  };

  if (typeof payload.url !== "string" || payload.url.trim() === "") {
    throw new InputError("Missing url.");
  }

  if (
    payload.waitForSelector !== undefined &&
    typeof payload.waitForSelector !== "string"
  ) {
    throw new InputError("waitForSelector must be a string.");
  }

  return {
    url: payload.url,
    waitForSelector: payload.waitForSelector
  };
}

export async function readRenderJob(request: Request): Promise<RenderJob> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");
    const waitForSelector = url.searchParams.get("waitForSelector") ?? undefined;

    return parseRenderJob({
      url: target,
      waitForSelector
    });
  }

  if (request.method === "POST") {
    const payload = await request.json();

    return parseRenderJob(payload);
  }

  throw new InputError("Only GET and POST are supported.");
}

export function assertToken(request: Request, config: RenderConfig): void {
  if (!config.token) {
    return;
  }

  const token = request.headers.get("x-render-token");

  if (token === config.token) {
    return;
  }

  throw new InputError("Invalid render token.");
}

