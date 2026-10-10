import type { RenderConfig, RenderJob, RenderResult } from "./render/types";
import { getTimeout, getRequestRenderConfig } from "./render/config";
import { getBrowser } from "./render/browser";
import { assertAllowedTarget, assertToken, readRenderJob, InputError } from "./render/request";
import { installTracking, waitForSettle } from "./render/tracking";
export { closeRenderBrowser } from "./render/browser";

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
    const result = await renderPage(
      job,
      getRequestRenderConfig(config)
    );

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
