import type { TransformerContext } from "./context";
import type { SupportedFormat, ResizeSpec, RasterImage, SvgImage, DecodedImage, TransformRemoteUrlInput, TransformBytesInput, TransformResult, TransformerLimits, TransformerEncodeOptions, ImageTransformerOptions, TransformErrorCode, TransformErrorStage, ImageTransformErrorDetails, UnknownErrorSummary, ImageTransformErrorBody, ResvgRenderOptions, ResvgInstance, ResvgStatic, CacheIndexEntry, CacheIndex, SvgIntrinsicSize } from "./types";
import { ImageTransformError } from "./errors";
const IMAGE_CACHE_DIR = "./data/images";
const IMAGE_CACHE_INDEX_PATH = "./data/images/index.json";
const IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_CACHE_SCHEMA_VERSION = "v4";
import * as jpeg from "jpeg-js";
import { join, posix as pathPosix } from "node:path";
import { createHash } from "node:crypto";
import fs from "fs";

export function cacheKeyFromRemoteRequest(
    ctx: TransformerContext,args: {
    srcUrl: string;
    outputFormat: SupportedFormat;
    resize: ResizeSpec;
    detectedSrcFormatHint: SupportedFormat;
  }): string {
    const w = args.resize.width ?? "";
    const h = args.resize.height ?? "";
    const raw = `${IMAGE_CACHE_SCHEMA_VERSION}|src=${args.srcUrl}|out=${args.outputFormat}|w=${w}|h=${h}|srcfmt=${args.detectedSrcFormatHint}`;
    return createHash("sha256").update(raw).digest("hex");
}

export async function ensureCacheDir(ctx: TransformerContext): Promise<void> {
    try {
      await fs.promises.mkdir(IMAGE_CACHE_DIR, { recursive: true });
    } catch (error) {
      console.error(`Failed to create cache dir ${IMAGE_CACHE_DIR}:`, error);
      throw new ImageTransformError({
        code: "INTERNAL",
        httpStatus: 500,
        message: "Failed to create image cache directory",
        stage: "cache",
        details: {
          cacheDir: IMAGE_CACHE_DIR,
          action: "mkdir",
        },
        cause: error,
      });
    }
}

export async function readCacheIndex(ctx: TransformerContext): Promise<CacheIndex> {
    await ctx.ensureCacheDir();

    let raw: string;
    try {
      raw = await fs.promises.readFile(IMAGE_CACHE_INDEX_PATH, "utf-8");
    } catch (error: unknown) {
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code === "ENOENT") return {};
      console.error(`Failed to read cache index ${IMAGE_CACHE_INDEX_PATH}:`, error);
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed as CacheIndex;
    } catch {
      return {};
    }
}

export async function writeCacheIndex(ctx: TransformerContext, index: CacheIndex): Promise<void> {
    await ctx.ensureCacheDir();

    const tmpPath = `${IMAGE_CACHE_INDEX_PATH}.tmp`;
    const body = JSON.stringify(index, null, 2);

    try {
      await fs.promises.writeFile(tmpPath, body, "utf-8");
      await fs.promises.rename(tmpPath, IMAGE_CACHE_INDEX_PATH);
    } catch (error) {
      console.error(`Failed to write cache index ${IMAGE_CACHE_INDEX_PATH}:`, error);
    }
}

export async function purgeExpiredCacheEntries(ctx: TransformerContext, index: CacheIndex): Promise<boolean> {
    const now = Date.now();
    let changed = false;

    const keys = Object.keys(index);
    for (const k of keys) {
      const entry = index[k];
      const expired = now - entry.createdAtMs >= IMAGE_CACHE_TTL_MS;
      if (!expired) continue;

      changed = true;
      delete index[k];

      const filePath = join(IMAGE_CACHE_DIR, entry.fileName);
      try {
        await fs.promises.unlink(filePath);
      } catch {
      }
    }

    return changed;
}

export async function tryLoadFromCache(
    ctx: TransformerContext,args: {
    kind: "remote";
    srcUrl: string;
    outputFormat: SupportedFormat;
    resize: ResizeSpec;
    detectedSrcFormatHint: SupportedFormat;
  }): Promise<TransformResult | null> {
    const key = ctx.cacheKeyFromRemoteRequest(args);
    const index = await ctx.readCacheIndex();

    const changed = await ctx.purgeExpiredCacheEntries(index);
    if (changed) await ctx.writeCacheIndex(index);

    const entry = index[key];
    if (!entry) return null;

    const filePath = join(IMAGE_CACHE_DIR, entry.fileName);

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await fs.promises.readFile(filePath));
    } catch {
      delete index[key];
      await ctx.writeCacheIndex(index);
      return null;
    }

    return {
      body: bytes,
      contentType: entry.contentType,
      outputFormat: entry.outputFormat,
      detectedSrcFormat: entry.detectedSrcFormat,
      width: entry.width,
      height: entry.height,
    };
}

export function extensionForContentType(ctx: TransformerContext, contentType: string): string {
    const ct = contentType.split(";")[0]?.trim().toLowerCase();
    switch (ct) {
      case "image/png":
        return "png";
      case "image/jpeg":
        return "jpg";
      case "image/gif":
        return "gif";
      case "image/bmp":
        return "bmp";
      case "image/svg+xml":
        return "svg";
      case "image/tiff":
        return "tiff";
      case "image/webp":
        return "webp";
      default:
        return "bin";
    }
}

export async function saveToCache(
    ctx: TransformerContext,
    args: {
      kind: "remote";
      srcUrl: string;
      outputFormat: SupportedFormat;
      resize: ResizeSpec;
      detectedSrcFormatHint: SupportedFormat;
    },
    result: TransformResult,
  ): Promise<void> {
    const key = ctx.cacheKeyFromRemoteRequest(args);
    const index = await ctx.readCacheIndex();

    const ext = ctx.extensionForContentType(result.contentType);
    const fileName = `${key}.${ext}`;
    const filePath = join(IMAGE_CACHE_DIR, fileName);

    try {
      await ctx.ensureCacheDir();
      await fs.promises.writeFile(filePath, Buffer.from(result.body));
    } catch (error) {
      console.error(`Failed to write cache file ${filePath}:`, error);
      return;
    }

    index[key] = {
      fileName,
      createdAtMs: Date.now(),
      contentType: result.contentType,
      outputFormat: result.outputFormat,
      detectedSrcFormat: result.detectedSrcFormat,
      width: result.width,
      height: result.height,
    };

    await ctx.writeCacheIndex(index);
}
