import puppeteer, { Browser, Page } from "puppeteer-core";

export interface RenderJob {
  url: string;
  waitForSelector?: string;
}

export interface RenderResult {
  status: number;
  finalUrl: string;
  html: string;
  contentType: string | null;
}

export interface RenderConfig {
  token?: string;
  allowedOrigins?: string[];
  timeoutMs?: number;
  viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  launch?: Parameters<typeof puppeteer.launch>[0];
}

type RenderState = {
  inflight: number;
  mutationCount: number;
  lastCheckedMutationCount: number;
  quietFrameCount: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ALLOWED_ORIGINS = ["https://kittycrypto.gg"];

let browserPromise: Promise<Browser> | null = null;

class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

function getAllowedOrigins(config: RenderConfig): Set<string> {
  const origins = config.allowedOrigins?.length
    ? config.allowedOrigins
    : DEFAULT_ALLOWED_ORIGINS;

  return new Set(
    origins.map((origin) => {
      return new URL(origin).origin;
    })
  );
}

function getTimeout(config: RenderConfig): number {
  return config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

function createBrowser(config: RenderConfig): Promise<Browser> {
  const launch = config.launch ?? {};
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    ...(launch.args ?? [])
  ];

const launchBrowser = async (): Promise<Browser> => {
    const browser = await puppeteer.launch({
        headless: true,
        ...launch,
        args
    });

    browser.once("disconnected", () => {
        browserPromise = null;
    });

    return browser;
};

return launchBrowser();
}

async function getBrowser(config: RenderConfig): Promise<Browser> {
  if (browserPromise === null) {
    browserPromise = createBrowser(config);
  }

  const browser = await browserPromise;

  if (browser.connected) {
    return browser;
  }

  browserPromise = createBrowser(config);

  return browserPromise;
}

function assertAllowedTarget(url: URL, config: RenderConfig): void {
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

async function readRenderJob(request: Request): Promise<RenderJob> {
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

function assertToken(request: Request, config: RenderConfig): void {
  if (!config.token) {
    return;
  }

  const token = request.headers.get("x-render-token");

  if (token === config.token) {
    return;
  }

  throw new InputError("Invalid render token.");
}

async function installTracking(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    const win = window as Window & {
      __RENDER__?: RenderState;
    };

    const state: RenderState = {
      inflight: 0,
      mutationCount: 0,
      lastCheckedMutationCount: 0,
      quietFrameCount: 0
    };

    Object.defineProperty(win, "__RENDER__", {
      value: state,
      writable: false,
      configurable: false,
      enumerable: false
    });

    const mark = (): void => {
      state.mutationCount += 1;
      state.quietFrameCount = 0;
    };

    const begin = (): void => {
      state.inflight += 1;
      state.quietFrameCount = 0;
    };

    const end = (): void => {
      state.inflight = Math.max(0, state.inflight - 1);
    };

    const startObserver = (): void => {
      const root = document.documentElement;

      if (root === null) {
        return;
      }

      const observer = new MutationObserver(() => {
        mark();
      });

      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
    };

    if (document.documentElement !== null) {
      startObserver();
    } else {
      document.addEventListener("readystatechange", startObserver, {
        once: true
      });
    }

    if (typeof window.fetch === "function") {
      const realFetch = window.fetch.bind(window);

      window.fetch = async (...args) => {
        begin();

        try {
          return await realFetch(...args);
        } finally {
          end();
        }
      };
    }

    if (typeof XMLHttpRequest !== "undefined") {
      const realSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.send = function (...args) {
        begin();

        this.addEventListener("loadend", () => {
          end();
        }, { once: true });

        return realSend.apply(
          this,
          args as Parameters<XMLHttpRequest["send"]>
        );
      };
    }
  });
}

async function waitForSettle(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const win = window as Window & {
        __RENDER__?: RenderState;
      };

      const state = win.__RENDER__;

      if (state === undefined) {
        return false;
      }

      if (state.inflight > 0) {
        state.lastCheckedMutationCount = state.mutationCount;
        state.quietFrameCount = 0;
        return false;
      }

      if (state.mutationCount !== state.lastCheckedMutationCount) {
        state.lastCheckedMutationCount = state.mutationCount;
        state.quietFrameCount = 0;
        return false;
      }

      state.quietFrameCount += 1;

      return state.quietFrameCount >= 2;
    },
    {
      polling: "raf",
      timeout: timeoutMs
    }
  );
}

export async function renderPage(
  job: RenderJob,
  config: RenderConfig = {}
): Promise<RenderResult> {
  const timeoutMs = getTimeout(config);
  const targetUrl = new URL(job.url);

  assertAllowedTarget(targetUrl, config);

  const browser = await getBrowser(config);
  const page = await browser.newPage();

  try {
    await page.setViewport(config.viewport ?? {
      width: 1440,
      height: 1024,
      deviceScaleFactor: 1
    });

    await installTracking(page);

    const response = await page.goto(targetUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    await page.waitForFunction(
      () => document.readyState === "complete",
      {
        polling: "raf",
        timeout: timeoutMs
      }
    );

    if (job.waitForSelector) {
      await page.waitForSelector(job.waitForSelector, {
        timeout: timeoutMs
      });
    }

    await waitForSettle(page, timeoutMs);
    await waitForSettle(page, timeoutMs);

    const html = await page.content();

    return {
      status: response?.status() ?? 200,
      finalUrl: page.url(),
      html,
      contentType: response?.headers()["content-type"] ?? null
    };
  } finally {
    await page.close();
  }
}

export async function handleRenderRequest(
  request: Request,
  config: RenderConfig = {}
): Promise<Response> {
  try {
    assertToken(request, config);

    const job = await readRenderJob(request);
    const result = await renderPage(job, config);

    return new Response(result.html, {
      status: result.status,
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "cache-control": "no-store",
        "x-render-final-url": result.finalUrl
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof InputError ? 400 : 500;

    return new Response(`Render failed: ${message}`, {
      status,
      headers: {
        "content-type": "text/plain; charset=UTF-8"
      }
    });
  }
}

export async function closeRenderBrowser(): Promise<void> {
  if (browserPromise === null) {
    return;
  }

  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}