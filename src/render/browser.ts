import puppeteer, { type Browser } from "puppeteer-core";
import type { RenderConfig } from "./types";
import { getExecutablePath } from "./config";

let browserPromise: Promise<Browser> | null = null;
function createBrowser(config: RenderConfig): Promise<Browser> {
  const launch = config.launch ?? {};
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    ...(launch.args ?? [])
  ];

  const executablePath = launch.executablePath ?? getExecutablePath(config);

  const launchBrowser = async (): Promise<Browser> => {
    const browser = await puppeteer.launch({
      headless: true,
      ...launch,
      executablePath,
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

export async function closeRenderBrowser(): Promise<void> {
  if (browserPromise === null) {
    return;
  }

  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}
