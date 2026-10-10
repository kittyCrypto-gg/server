import type puppeteer from "puppeteer-core";

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
  executablePath?: string;
}

export type RenderState = {
  inflight: number;
  mutationCount: number;
  lastCheckedMutationCount: number;
  quietFrameCount: number;
};

