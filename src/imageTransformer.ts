import { decode as decodePng, encode as encodePng } from "@cf-wasm/png";
import * as jpeg from "jpeg-js";
import { parseGIF, decompressFrames } from "gifuct-js";
import { join, posix as pathPosix } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { GifReader } from "omggif";
import * as BMP from "bmp-js";
import fs from "fs";

/* @ts-ignore */
import { GIFEncoder, quantize, applyPalette } from "gifenc";
/* @ts-ignore */
import { Resvg } from "@cf-wasm/resvg/node";
/* @ts-ignore */
import * as UTIF from "utif";

const ALLOWED_IMAGE_SOURCE_HOSTS = new Set<string>([
  "kittycrypto.gg",
]);

const EXTRASOURCES_PATH = "./data/extra_sources.json";

const IMAGE_CACHE_DIR = "./data/images";
const IMAGE_CACHE_INDEX_PATH = "./data/images/index.json";
const IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_CACHE_SCHEMA_VERSION = "v4";

export type SupportedFormat =
  | "svg"
  | "png"
  | "gif"
  | "bmp"
  | "jpg"
  | "jpeg"
  | "tiff"
  | "tif"
  | "webp";

export type ResizeSpec = {
  width?: number;
  height?: number;
};

type RasterImage = {
  kind: "raster";
  width: number;
  height: number;
  rgba: Uint8Array;
};

type SvgImage = {
  kind: "svg";
  svgText: string;
};

type DecodedImage = RasterImage | SvgImage;

export type TransformRemoteUrlInput = {
  src: string;
  baseUrl?: string;
  format?: SupportedFormat;
  srcFormatHint?: SupportedFormat;
  resize?: ResizeSpec;
  requestHeaders?: Record<string, string>;
  nocache?: boolean;
  refresh?: boolean;
};

export type TransformBytesInput = {
  bytes: Uint8Array;
  originalUrlHint?: string;
  format?: SupportedFormat;
  srcFormatHint?: SupportedFormat;
  resize?: ResizeSpec;
  contentTypeHint?: string;
};

export type TransformResult = {
  body: Uint8Array;
  contentType: string;
  outputFormat: SupportedFormat;
  detectedSrcFormat: SupportedFormat;
  width: number;
  height: number;
};

type TransformerLimits = {
  maxPixels: number;
  maxSrcBytes: number;
};

type TransformerEncodeOptions = {
  jpegQuality: number;
};

export type ImageTransformerOptions = Partial<TransformerLimits & TransformerEncodeOptions>;

export type TransformErrorCode =
  | "BAD_REQUEST"
  | "FETCH_FAILED"
  | "UNSUPPORTED_FORMAT"
  | "PAYLOAD_TOO_LARGE"
  | "IMAGE_TOO_LARGE"
  | "DECODE_FAILED"
  | "TRANSFORM_FAILED"
  | "ENCODE_FAILED"
  | "INTERNAL";

export type TransformErrorStage =
  | "parse-source-url"
  | "validate-source-url"
  | "read-allowlist"
  | "fetch-source"
  | "read-source-body"
  | "detect-source-format"
  | "cache"
  | "pass-through"
  | "decode"
  | "transform"
  | "encode"
  | "internal";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type ImageTransformErrorDetails = Record<string, JsonValue>;

type UnknownErrorSummary = {
  name: string;
  message: string;
  code?: string;
  errno?: number;
  syscall?: string;
  hostname?: string;
  address?: string;
  port?: number;
  stack?: string;
  cause?: UnknownErrorSummary;
};

export type ImageTransformErrorBody = {
  ok: false;
  error: {
    code: TransformErrorCode;
    httpStatus: number;
    message: string;
    stage: TransformErrorStage;
    details: ImageTransformErrorDetails;
    cause?: UnknownErrorSummary;
  };
};

export class ImageTransformError extends Error {
  public readonly code: TransformErrorCode;
  public readonly httpStatus: number;
  public readonly stage: TransformErrorStage;
  public readonly details: ImageTransformErrorDetails;
  public readonly causeValue?: unknown;

  public constructor(args: {
    code: TransformErrorCode;
    httpStatus: number;
    message: string;
    stage: TransformErrorStage;
    details?: ImageTransformErrorDetails;
    cause?: unknown;
  }) {
    super(args.message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = "ImageTransformError";
    this.code = args.code;
    this.httpStatus = args.httpStatus;
    this.stage = args.stage;
    this.details = args.details ?? {};
    this.causeValue = args.cause;
  }

  public toBody(options?: { includeStack?: boolean }): ImageTransformErrorBody {
    const body: ImageTransformErrorBody = {
      ok: false,
      error: {
        code: this.code,
        httpStatus: this.httpStatus,
        message: this.message,
        stage: this.stage,
        details: this.details,
      },
    };

    if (this.causeValue !== undefined) {
      body.error.cause = summariseUnknownError(this.causeValue, Boolean(options?.includeStack));
    }

    return body;
  }
}

export function toImageTransformErrorBody(
  error: unknown,
  options?: { includeStack?: boolean },
): ImageTransformErrorBody {
  if (error instanceof ImageTransformError) {
    return error.toBody(options);
  }

  return {
    ok: false,
    error: {
      code: "INTERNAL",
      httpStatus: 500,
      message: "Unexpected image transform failure",
      stage: "internal",
      details: {},
      cause: summariseUnknownError(error, Boolean(options?.includeStack)),
    },
  };
}

export function createImageTransformErrorBody(args: {
  code: TransformErrorCode;
  httpStatus: number;
  message: string;
  stage: TransformErrorStage;
  details?: ImageTransformErrorDetails;
  cause?: unknown;
  includeStack?: boolean;
}): ImageTransformErrorBody {
  const error = new ImageTransformError(args);
  return error.toBody({ includeStack: args.includeStack });
}

type ResvgRenderOptions = {
  fitTo?: { mode: "original" };
  font?: {
    loadSystemFonts?: boolean;
    fontFiles?: string[];
    fontDirs?: string[];
    fontBuffers?: Uint8Array[];
    defaultFontFamily?: string;
    sansSerifFamily?: string;
    serifFamily?: string;
    monospaceFamily?: string;
    defaultFontSize?: number;
  };
};

type ResvgInstance = {
  render(): { asPng(): Uint8Array };
};

type ResvgStatic = {
  async(svg: string, options?: ResvgRenderOptions): Promise<ResvgInstance>;
};

const ResvgTyped = Resvg as unknown as ResvgStatic;

type CacheIndexEntry = {
  fileName: string;
  createdAtMs: number;
  contentType: string;
  outputFormat: SupportedFormat;
  detectedSrcFormat: SupportedFormat;
  width: number;
  height: number;
};

type CacheIndex = Record<string, CacheIndexEntry>;

type ErrorRecord = Record<string, unknown>;

type SvgIntrinsicSize = {
  width?: number;
  height?: number;
  viewBox?: { w: number; h: number };
};

function summariseUnknownError(error: unknown, includeStack: boolean, depth = 0): UnknownErrorSummary {
  if (depth > 4) {
    return {
      name: "CauseChainTruncated",
      message: "Nested cause chain truncated",
    };
  }

  if (!(error instanceof Error)) {
    return {
      name: typeof error,
      message: String(error),
    };
  }

  const record = error as unknown as ErrorRecord;
  const summary: UnknownErrorSummary = {
    name: error.name || "Error",
    message: error.message || "Unknown error",
  };

  const code = readStringField(record, "code");
  if (code) summary.code = code;

  const errno = readNumberField(record, "errno");
  if (errno !== null) summary.errno = errno;

  const syscall = readStringField(record, "syscall");
  if (syscall) summary.syscall = syscall;

  const hostname = readStringField(record, "hostname");
  if (hostname) summary.hostname = hostname;

  const address = readStringField(record, "address");
  if (address) summary.address = address;

  const port = readNumberField(record, "port");
  if (port !== null) summary.port = port;

  if (includeStack && error.stack) {
    summary.stack = error.stack;
  }

  if (record.cause !== undefined) {
    summary.cause = summariseUnknownError(record.cause, includeStack, depth + 1);
  }

  return summary;
}

function readStringField(record: ErrorRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumberField(record: ErrorRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function isAllowedImageSourceUrl(u: URL): Promise<boolean> {
  if (u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();
  if (host.endsWith(".kittycrypto.gg")) return true;

  const allowedHosts = new Set<string>();
  for (const h of ALLOWED_IMAGE_SOURCE_HOSTS) allowedHosts.add(h.toLowerCase());

  const extraHosts = await readExtraSourceHosts();
  for (const h of extraHosts) allowedHosts.add(h);

  return allowedHosts.has(host);
}

async function readExtraSourceHosts(): Promise<Set<string>> {
  const ensureEmptyFile = async (): Promise<Set<string>> => {
    try {
      await fs.promises.writeFile(EXTRASOURCES_PATH, "{}", "utf-8");
      return new Set<string>();
    } catch (error) {
      console.error(`Failed to create ${EXTRASOURCES_PATH}:`, error);
      throw new ImageTransformError({
        code: "INTERNAL",
        httpStatus: 500,
        message: "Failed to initialise extra image source allowlist",
        stage: "read-allowlist",
        details: {
          path: EXTRASOURCES_PATH,
          action: "create-empty-file",
        },
        cause: error,
      });
    }
  };

  const backupCorruptFile = async (): Promise<void> => {
    const safeStamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${EXTRASOURCES_PATH}.bak-${safeStamp}`;

    try {
      await fs.promises.rename(EXTRASOURCES_PATH, backupPath);
    } catch (error) {
      console.error(`Failed to back up corrupt ${EXTRASOURCES_PATH}:`, error);
      throw new ImageTransformError({
        code: "INTERNAL",
        httpStatus: 500,
        message: "Failed to back up corrupt extra image source allowlist",
        stage: "read-allowlist",
        details: {
          path: EXTRASOURCES_PATH,
          backupPath,
          action: "backup-corrupt-file",
        },
        cause: error,
      });
    }
  };

  let raw: string;
  try {
    raw = await fs.promises.readFile(EXTRASOURCES_PATH, "utf-8");
  } catch (error: unknown) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return ensureEmptyFile();

    console.error(`Failed to read ${EXTRASOURCES_PATH}:`, error);
    throw new ImageTransformError({
      code: "INTERNAL",
      httpStatus: 500,
      message: "Failed to read extra image source allowlist",
      stage: "read-allowlist",
      details: {
        path: EXTRASOURCES_PATH,
        action: "read-file",
      },
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    await backupCorruptFile();
    console.error(`Corrupt ${EXTRASOURCES_PATH} was reset:`, error);
    return ensureEmptyFile();
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    await backupCorruptFile();
    return ensureEmptyFile();
  }

  const obj = parsed as Record<string, unknown>;
  const hosts = new Set<string>();

  for (const value of Object.values(obj)) {
    if (typeof value !== "string") continue;

    const candidate = value.trim().toLowerCase();
    if (candidate.length > 0) hosts.add(candidate);
  }

  return hosts;
}

export class ImageTransformer {
  private readonly limits: TransformerLimits;
  private readonly encodeOptions: TransformerEncodeOptions;

  public constructor(options?: ImageTransformerOptions) {
    this.limits = {
      maxPixels: options?.maxPixels ?? 20_000_000,
      maxSrcBytes: options?.maxSrcBytes ?? 25 * 1024 * 1024,
    };

    this.encodeOptions = {
      jpegQuality: options?.jpegQuality ?? 85,
    };
  }

  public async transformRemoteUrl(input: TransformRemoteUrlInput): Promise<TransformResult> {
    const srcUrl = this.resolveSrcUrlWithDetail(input.src, input.baseUrl);

    let sourceAllowed = false;
    try {
      sourceAllowed = await isAllowedImageSourceUrl(srcUrl);
    } catch (error) {
      if (error instanceof ImageTransformError) throw error;

      throw new ImageTransformError({
        code: "INTERNAL",
        httpStatus: 500,
        message: "Failed while validating image source URL",
        stage: "validate-source-url",
        details: this.sourceDetails(srcUrl),
        cause: error,
      });
    }

    if (!sourceAllowed) {
      throw new ImageTransformError({
        code: "BAD_REQUEST",
        httpStatus: 403,
        message: `Source not allowed: ${srcUrl.hostname}`,
        stage: "validate-source-url",
        details: {
          ...this.sourceDetails(srcUrl),
          reason: "The source host is not present in the image source allowlist",
        },
      });
    }

    const resizeSpec = input.resize ?? {};
    const wantsResize = Boolean(resizeSpec.width || resizeSpec.height);
    const response = await this.fetchRemoteSource(srcUrl, input.requestHeaders);
    const srcBytes = await this.readResponseBytes(response, srcUrl);

    this.assertByteBudget(srcBytes.byteLength, {
      stage: "read-source-body",
      ...this.sourceDetails(srcUrl),
    });

    const detectedSrcFormat =
      input.srcFormatHint ??
      this.detectFormatFromHeaders(response.headers) ??
      this.detectFormatFromUrl(srcUrl) ??
      this.detectFormatFromMagicBytes(srcBytes);

    if (!detectedSrcFormat) {
      throw new ImageTransformError({
        code: "BAD_REQUEST",
        httpStatus: 400,
        message: "Could not determine source image format",
        stage: "detect-source-format",
        details: {
          ...this.sourceDetails(srcUrl),
          contentType: response.headers.get("content-type") ?? null,
          byteLength: srcBytes.byteLength,
          firstBytesHex: this.firstBytesHex(srcBytes),
          suggestion: "Provide srcFormatHint=png|jpg|svg|gif|bmp|tif|tiff|webp",
        },
      });
    }

    const outputFormat = input.format ?? detectedSrcFormat;
    const isPassThroughWebp = detectedSrcFormat === "webp";
    const isPassThroughGif = detectedSrcFormat === "gif" && outputFormat === "gif" && !wantsResize;

    if (isPassThroughWebp) {
      return this.passThroughWebp(input, srcBytes, detectedSrcFormat);
    }

    if (isPassThroughGif) {
      return this.passThroughGif(input, srcBytes, detectedSrcFormat);
    }

    if (!input.nocache && !input.refresh) {
      const cached = await this.tryLoadFromCache({
        kind: "remote",
        srcUrl: srcUrl.toString(),
        outputFormat,
        resize: resizeSpec,
        detectedSrcFormatHint: detectedSrcFormat,
      });

      if (cached) return cached;
    }

    this.assertSupportedFormat(detectedSrcFormat, "input");
    this.assertSupportedFormat(outputFormat, "output");

    const decoded = await this.decodeImage(detectedSrcFormat, srcBytes);
    const resized = await this.transform(decoded, resizeSpec, outputFormat);
    const encoded = await this.encodeOutput(resized, outputFormat);
    const size = this.getDecodedSize(resized);

    const result: TransformResult = {
      body: encoded.body,
      contentType: encoded.contentType,
      outputFormat,
      detectedSrcFormat,
      width: size.width,
      height: size.height,
    };

    if (!input.nocache) {
      await this.saveToCache({
        kind: "remote",
        srcUrl: srcUrl.toString(),
        outputFormat,
        resize: resizeSpec,
        detectedSrcFormatHint: detectedSrcFormat,
      }, result);
    }

    return result;
  }

  public async transformBytes(input: TransformBytesInput): Promise<TransformResult> {
    this.assertByteBudget(input.bytes.byteLength, {
      stage: "read-source-body",
      source: "bytes-input",
    });

    const urlHint = this.parseOptionalUrlHint(input.originalUrlHint);

    const detectedSrcFormat =
      input.srcFormatHint ??
      (input.contentTypeHint ? this.detectFormatFromContentType(input.contentTypeHint) : null) ??
      (urlHint ? this.detectFormatFromUrl(urlHint) : null) ??
      this.detectFormatFromMagicBytes(input.bytes);

    if (!detectedSrcFormat) {
      throw new ImageTransformError({
        code: "BAD_REQUEST",
        httpStatus: 400,
        message: "Could not determine source image format",
        stage: "detect-source-format",
        details: {
          source: "bytes-input",
          originalUrlHint: input.originalUrlHint ?? null,
          contentTypeHint: input.contentTypeHint ?? null,
          byteLength: input.bytes.byteLength,
          firstBytesHex: this.firstBytesHex(input.bytes),
          suggestion: "Provide srcFormatHint=png|jpg|svg|gif|bmp|tif|tiff|webp",
        },
      });
    }

    const outputFormat = input.format ?? detectedSrcFormat;
    const resizeSpec = input.resize ?? {};
    const wantsResize = Boolean(resizeSpec.width || resizeSpec.height);

    if (detectedSrcFormat === "webp") {
      return this.passThroughWebp(input, input.bytes, detectedSrcFormat);
    }

    if (detectedSrcFormat === "gif" && outputFormat === "gif" && !wantsResize) {
      return this.passThroughGif(input, input.bytes, detectedSrcFormat);
    }

    this.assertSupportedFormat(detectedSrcFormat, "input");
    this.assertSupportedFormat(outputFormat, "output");

    const decoded = await this.decodeImage(detectedSrcFormat, input.bytes);
    const resized = await this.transform(decoded, resizeSpec, outputFormat);
    const encoded = await this.encodeOutput(resized, outputFormat);
    const size = this.getDecodedSize(resized);

    return {
      body: encoded.body,
      contentType: encoded.contentType,
      outputFormat,
      detectedSrcFormat,
      width: size.width,
      height: size.height,
    };
  }

  private resolveSrcUrlWithDetail(src: string, baseUrl?: string): URL {
    try {
      return this.resolveSrcUrl(src, baseUrl);
    } catch (error) {
      throw new ImageTransformError({
        code: "BAD_REQUEST",
        httpStatus: 400,
        message: "Invalid image source URL",
        stage: "parse-source-url",
        details: {
          src,
          baseUrl: baseUrl ?? null,
        },
        cause: error,
      });
    }
  }

  private parseOptionalUrlHint(originalUrlHint?: string): URL | null {
    if (!originalUrlHint) return null;

    try {
      return new URL(originalUrlHint);
    } catch (error) {
      throw new ImageTransformError({
        code: "BAD_REQUEST",
        httpStatus: 400,
        message: "Invalid originalUrlHint",
        stage: "parse-source-url",
        details: {
          originalUrlHint,
        },
        cause: error,
      });
    }
  }

  private async fetchRemoteSource(srcUrl: URL, requestHeaders?: Record<string, string>): Promise<Response> {
    const acceptHeader = "image/*,application/octet-stream;q=0.9,*/*;q=0.1";

    let response: Response;
    try {
      response = await fetch(srcUrl.toString(), {
        headers: {
          Accept: acceptHeader,
          ...(requestHeaders ?? {}),
        },
      });
    } catch (error) {
      throw new ImageTransformError({
        code: "FETCH_FAILED",
        httpStatus: 502,
        message: "Network fetch failed before a response was received",
        stage: "fetch-source",
        details: {
          ...this.sourceDetails(srcUrl),
          requestAccept: acceptHeader,
        },
        cause: error,
      });
    }

    if (response.ok) return response;

    throw new ImageTransformError({
      code: "FETCH_FAILED",
      httpStatus: 502,
      message: `Source server returned HTTP ${response.status}`,
      stage: "fetch-source",
      details: {
        ...this.sourceDetails(srcUrl),
        responseUrl: response.url || srcUrl.toString(),
        responseStatus: response.status,
        responseStatusText: response.statusText,
        responseHeaders: this.headersToJsonObject(response.headers),
      },
    });
  }

  private async readResponseBytes(response: Response, srcUrl: URL): Promise<Uint8Array> {
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw new ImageTransformError({
        code: "FETCH_FAILED",
        httpStatus: 502,
        message: "Fetched source but failed while reading response body",
        stage: "read-source-body",
        details: {
          ...this.sourceDetails(srcUrl),
          responseUrl: response.url || srcUrl.toString(),
          responseStatus: response.status,
          responseHeaders: this.headersToJsonObject(response.headers),
        },
        cause: error,
      });
    }
  }

  private passThroughWebp(
    input: { format?: SupportedFormat; resize?: ResizeSpec },
    bytes: Uint8Array,
    detectedSrcFormat: SupportedFormat,
  ): TransformResult {
    const requestedFormat = input.format ?? detectedSrcFormat;
    if (requestedFormat !== "webp") {
      throw new ImageTransformError({
        code: "UNSUPPORTED_FORMAT",
        httpStatus: 400,
        message: "webp can only be returned as webp",
        stage: "pass-through",
        details: {
          detectedSrcFormat,
          requestedFormat,
          reason: "webp decoding and conversion are not supported by this transformer",
        },
      });
    }

    const wantsResize = Boolean(input.resize?.width || input.resize?.height);
    if (wantsResize) {
      throw new ImageTransformError({
        code: "UNSUPPORTED_FORMAT",
        httpStatus: 400,
        message: "webp cannot be resized or transformed",
        stage: "pass-through",
        details: {
          detectedSrcFormat,
          requestedFormat,
          resize: this.resizeSpecDetails(input.resize ?? {}),
          reason: "webp is currently pass-through only",
        },
      });
    }

    return {
      body: bytes,
      contentType: "image/webp",
      outputFormat: "webp",
      detectedSrcFormat: "webp",
      width: 0,
      height: 0,
    };
  }

  private passThroughGif(
    input: { format?: SupportedFormat; resize?: ResizeSpec },
    bytes: Uint8Array,
    detectedSrcFormat: SupportedFormat,
  ): TransformResult {
    const requestedFormat = input.format ?? detectedSrcFormat;
    if (requestedFormat !== "gif") {
      throw new ImageTransformError({
        code: "UNSUPPORTED_FORMAT",
        httpStatus: 400,
        message: "Internal: expected gif pass-through",
        stage: "pass-through",
        details: {
          detectedSrcFormat,
          requestedFormat,
        },
      });
    }

    const wantsResize = Boolean(input.resize?.width || input.resize?.height);
    if (wantsResize) {
      throw new ImageTransformError({
        code: "UNSUPPORTED_FORMAT",
        httpStatus: 400,
        message: "Animated gif cannot be resized or transformed when output is gif",
        stage: "pass-through",
        details: {
          detectedSrcFormat,
          requestedFormat,
          resize: this.resizeSpecDetails(input.resize ?? {}),
        },
      });
    }

    try {
      const reader = new GifReader(Buffer.from(bytes));

      return {
        body: bytes,
        contentType: "image/gif",
        outputFormat: "gif",
        detectedSrcFormat: "gif",
        width: reader.width,
        height: reader.height,
      };
    } catch (error) {
      throw new ImageTransformError({
        code: "DECODE_FAILED",
        httpStatus: 400,
        message: "GIF pass-through failed while reading GIF dimensions",
        stage: "pass-through",
        details: {
          detectedSrcFormat,
          requestedFormat,
          byteLength: bytes.byteLength,
          firstBytesHex: this.firstBytesHex(bytes),
        },
        cause: error,
      });
    }
  }

  private getDecodedSize(image: DecodedImage): { width: number; height: number } {
    if (image.kind === "svg") {
      const intrinsic = this.getSvgIntrinsicSize(image.svgText);
      return this.getSvgBaseSize(intrinsic);
    }

    return { width: image.width, height: image.height };
  }

  private resolveSrcUrl(src: string, baseUrl?: string): URL {
    const base = baseUrl ? new URL(baseUrl) : undefined;
    return base ? new URL(src, base) : new URL(src);
  }

  private assertByteBudget(byteLength: number, details: ImageTransformErrorDetails): void {
    if (byteLength <= this.limits.maxSrcBytes) return;

    throw new ImageTransformError({
      code: "PAYLOAD_TOO_LARGE",
      httpStatus: 400,
      message: "Source image is too large",
      stage: "read-source-body",
      details: {
        ...details,
        byteLength,
        maxSrcBytes: this.limits.maxSrcBytes,
      },
    });
  }

  private assertPixelBudget(w: number, h: number): void {
    const pixels = w * h;
    if (pixels <= this.limits.maxPixels) return;

    throw new ImageTransformError({
      code: "IMAGE_TOO_LARGE",
      httpStatus: 400,
      message: `Image too large: ${w}x${h} (${pixels} pixels)`,
      stage: "decode",
      details: {
        width: w,
        height: h,
        pixels,
        maxPixels: this.limits.maxPixels,
      },
    });
  }

  private assertSupportedFormat(format: string, side: "input" | "output"): void {
    if (this.isSupportedFormat(format)) return;

    throw new ImageTransformError({
      code: "UNSUPPORTED_FORMAT",
      httpStatus: 400,
      message: `Unsupported ${side} format: ${format}`,
      stage: side === "input" ? "decode" : "encode",
      details: {
        side,
        format,
        supportedFormats: ["svg", "png", "gif", "bmp", "jpg", "jpeg", "tif", "tiff", "webp"],
      },
    });
  }

  private normaliseFormat(value: string | null): SupportedFormat | null {
    if (!value) return null;
    const v = value.trim().toLowerCase();

    switch (v) {
      case "jpeg":
        return "jpeg";
      case "jpg":
        return "jpg";
      case "png":
        return "png";
      case "gif":
        return "gif";
      case "bmp":
        return "bmp";
      case "svg":
        return "svg";
      case "tif":
        return "tif";
      case "tiff":
        return "tiff";
      case "webp":
        return "webp";
      default:
        return null;
    }
  }

  private isSupportedFormat(f: string): f is SupportedFormat {
    return this.normaliseFormat(f) !== null;
  }

  private detectFormatFromHeaders(headers: Headers): SupportedFormat | null {
    const ct = headers.get("content-type");
    return ct ? this.detectFormatFromContentType(ct) : null;
  }

  private detectFormatFromContentType(contentType: string): SupportedFormat | null {
    const ct = contentType.split(";")[0]?.trim().toLowerCase();
    if (!ct) return null;

    const map: Record<string, SupportedFormat> = {
      "image/png": "png",
      "image/jpeg": "jpeg",
      "image/jpg": "jpg",
      "image/gif": "gif",
      "image/bmp": "bmp",
      "image/svg+xml": "svg",
      "image/tiff": "tiff",
      "image/webp": "webp",
    };

    return map[ct] ?? null;
  }

  private detectFormatFromUrl(u: URL): SupportedFormat | null {
    const ext = pathPosix.extname(u.pathname).toLowerCase();
    if (!ext) return null;
    return this.normaliseFormat(ext.slice(1));
  }

  private detectFormatFromMagicBytes(bytes: Uint8Array): SupportedFormat | null {
    if (bytes.length >= 12) {
      const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
      const isWebp =
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
      if (isRiff && isWebp) return "webp";
    }

    if (bytes.length >= 8) {
      const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      const isPng = pngSig.every((b, i) => bytes[i] === b);
      if (isPng) return "png";
    }

    if (bytes.length >= 3) {
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (isJpeg) return "jpeg";
    }

    if (bytes.length >= 6) {
      const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
      if (header === "GIF87a" || header === "GIF89a") return "gif";
    }

    if (bytes.length >= 2) {
      const isBmp = bytes[0] === 0x42 && bytes[1] === 0x4d;
      if (isBmp) return "bmp";
    }

    if (bytes.length >= 4) {
      const isLe = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
      const isBe = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
      if (isLe || isBe) return "tiff";
    }

    const head = bytes.slice(0, 128);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(head).trimStart();
    const looksLikeSvg = text.startsWith("<svg") || text.startsWith("<?xml") || text.startsWith("<!DOCTYPE svg");
    if (looksLikeSvg) return "svg";

    return null;
  }

  private async decodeImage(format: SupportedFormat, bytes: Uint8Array): Promise<DecodedImage> {
    try {
      switch (format) {
        case "svg": {
          const svgText = new TextDecoder("utf-8").decode(bytes);
          return { kind: "svg", svgText };
        }
        case "png":
          return await this.decodePngToRgba(bytes);
        case "jpg":
        case "jpeg":
          return await this.decodeJpegToRgba(bytes);
        case "bmp":
          return await this.decodeBmpToRgba(bytes);
        case "tif":
        case "tiff":
          return await this.decodeTiffToRgba(bytes);
        case "gif":
          return await this.decodeGifToRgba(bytes);
        case "webp":
          throw new Error("Internal: webp should be passed through without decoding");
      }
    } catch (error) {
      if (error instanceof ImageTransformError) throw error;

      const message = error instanceof Error ? error.message : "Unknown decode error";
      throw new ImageTransformError({
        code: "DECODE_FAILED",
        httpStatus: 400,
        message: `Decode failed while decoding ${format}: ${message}`,
        stage: "decode",
        details: {
          format,
          byteLength: bytes.byteLength,
          firstBytesHex: this.firstBytesHex(bytes),
        },
        cause: error,
      });
    }
  }

  private expandToRgba(raw: Uint8Array, width: number, height: number, format: SupportedFormat): Uint8Array {
    const pixels = width * height;
    const expected = pixels * 4;

    if (raw.length === expected) return raw;

    if (raw.length === pixels) {
      const out = new Uint8Array(expected);
      for (let i = 0, o = 0; i < raw.length; i++, o += 4) {
        const l = raw[i];
        out[o] = l;
        out[o + 1] = l;
        out[o + 2] = l;
        out[o + 3] = 255;
      }
      return out;
    }

    if (raw.length === pixels * 2) {
      const out = new Uint8Array(expected);
      for (let i = 0, o = 0; i < raw.length; i += 2, o += 4) {
        const l = raw[i];
        out[o] = l;
        out[o + 1] = l;
        out[o + 2] = l;
        out[o + 3] = raw[i + 1];
      }
      return out;
    }

    if (raw.length === pixels * 3) {
      const out = new Uint8Array(expected);
      for (let i = 0, o = 0; i < raw.length; i += 3, o += 4) {
        out[o] = raw[i];
        out[o + 1] = raw[i + 1];
        out[o + 2] = raw[i + 2];
        out[o + 3] = 255;
      }
      return out;
    }

    throw new ImageTransformError({
      code: "DECODE_FAILED",
      httpStatus: 400,
      message: `${format.toUpperCase()} decode returned unexpected pixel data length`,
      stage: "decode",
      details: {
        format,
        rawLength: raw.length,
        expectedRgbaLength: expected,
        width,
        height,
      },
    });
  }

  private async decodePngToRgba(bytes: Uint8Array): Promise<RasterImage> {
    let decoded: { image: unknown; width: number; height: number };

    try {
      decoded = decodePng(bytes);
    } catch (error) {
      throw new ImageTransformError({
        code: "DECODE_FAILED",
        httpStatus: 400,
        message: "PNG decoder failed",
        stage: "decode",
        details: {
          format: "png",
          byteLength: bytes.byteLength,
          firstBytesHex: this.firstBytesHex(bytes),
        },
        cause: error,
      });
    }

    const raw = (() => {
      const img = decoded.image;

      if (ArrayBuffer.isView(img)) {
        return new Uint8Array(img.buffer.slice(img.byteOffset, img.byteOffset + img.byteLength));
      }

      if ((img as unknown) instanceof ArrayBuffer) {
        return new Uint8Array(img as ArrayBuffer);
      }

      throw new ImageTransformError({
        code: "DECODE_FAILED",
        httpStatus: 400,
        message: "PNG decode returned unsupported pixel buffer type",
        stage: "decode",
        details: {
          format: "png",
          width: decoded.width,
          height: decoded.height,
          returnedType: typeof img,
        },
      });
    })();

    this.assertPixelBudget(decoded.width, decoded.height);

    const rgba = this.expandToRgba(raw, decoded.width, decoded.height, "png");
    return { kind: "raster", width: decoded.width, height: decoded.height, rgba };
  }

  private async decodeJpegToRgba(bytes: Uint8Array): Promise<RasterImage> {
    try {
      const decoded = jpeg.decode(Buffer.from(bytes), {
        useTArray: true,
      });

      const rgba = this.copyViewToUint8Array(decoded.data);
      this.assertPixelBudget(decoded.width, decoded.height);

      return { kind: "raster", width: decoded.width, height: decoded.height, rgba };
    } catch (error) {
      if (error instanceof ImageTransformError) throw error;

      throw new ImageTransformError({
        code: "DECODE_FAILED",
        httpStatus: 400,
        message: "JPEG decoder failed",
        stage: "decode",
        details: {
          format: "jpeg",
          byteLength: bytes.byteLength,
          firstBytesHex: this.firstBytesHex(bytes),
          decoder: "jpeg-js",
        },
        cause: error,
      });
    }
  }

  private async decodeBmpToRgba(bytes: Uint8Array): Promise<RasterImage> {
    try {
      const bmp = BMP.decode(Buffer.from(bytes));
      const rgba = this.copyViewToUint8Array(bmp.data);
      this.assertPixelBudget(bmp.width, bmp.height);

      return { kind: "raster", width: bmp.width, height: bmp.height, rgba };
    } catch (error) {
      if (error instanceof ImageTransformError) throw error;

      throw new ImageTransformError({
        code: "DECODE_FAILED",
        httpStatus: 400,
        message: "BMP decoder failed",
        stage: "decode",
        details: {
          format: "bmp",
          byteLength: bytes.byteLength,
          firstBytesHex: this.firstBytesHex(bytes),
        },
        cause: error,
      });
    }
  }

  private async decodeTiffToRgba(bytes: Uint8Array): Promise<RasterImage> {
    const ab = this.toExactArrayBuffer(bytes);

    try {
      const ifds = UTIF.decode(ab);
      if (!ifds.length) throw new Error("TIFF decode produced no images");

      UTIF.decodeImage(ab, ifds[0]);
      const rgba = UTIF.toRGBA8(ifds[0]) as Uint8Array;

      const width = Number(ifds[0].width ?? 0);
      const height = Number(ifds[0].height ?? 0);

      if (!width || !height) throw new Error("TIFF missing width/height");
      this.assertPixelBudget(width, height);

      return { kind: "raster", width, height, rgba };
    } catch (error) {
      if (error instanceof ImageTransformError) throw error;

      throw new ImageTransformError({
        code: "DECODE_FAILED",
        httpStatus: 400,
        message: "TIFF decoder failed",
        stage: "decode",
        details: {
          format: "tiff",
          byteLength: bytes.byteLength,
          firstBytesHex: this.firstBytesHex(bytes),
        },
        cause: error,
      });
    }
  }

  private async decodeGifToRgba(bytes: Uint8Array): Promise<RasterImage> {
    let firstDecoderError: unknown = null;

    try {
      const ab = this.toExactArrayBuffer(bytes);
      const parsed = parseGIF(ab);
      const frames = decompressFrames(parsed, true);
      if (!frames.length) throw new Error("GIF has no frames");

      const w = parsed.lsd.width;
      const h = parsed.lsd.height;
      this.assertPixelBudget(w, h);

      const canvas = new Uint8Array(w * h * 4);
      const f0 = frames[0];

      this.blitRgba(canvas, w, h, f0.patch, f0.dims.width, f0.dims.height, f0.dims.left, f0.dims.top);

      return { kind: "raster", width: w, height: h, rgba: canvas };
    } catch (error) {
      firstDecoderError = error;
    }

    try {
      const reader = new GifReader(Buffer.from(bytes));
      const w = reader.width;
      const h = reader.height;
      this.assertPixelBudget(w, h);
      const rgba = new Uint8Array(w * h * 4);
      reader.decodeAndBlitFrameRGBA(0, rgba);
      return { kind: "raster", width: w, height: h, rgba };
    } catch (error) {
      if (error instanceof ImageTransformError) throw error;

      throw new ImageTransformError({
        code: "DECODE_FAILED",
        httpStatus: 400,
        message: "GIF decode failed with both decoders",
        stage: "decode",
        details: {
          format: "gif",
          byteLength: bytes.byteLength,
          firstBytesHex: this.firstBytesHex(bytes),
          primaryDecoder: "gifuct-js",
          fallbackDecoder: "omggif",
          primaryDecoderError: summariseUnknownError(firstDecoderError, false).message,
        },
        cause: error,
      });
    }
  }

  private async transform(decoded: DecodedImage, resizeSpec: ResizeSpec, outputFormat: SupportedFormat): Promise<DecodedImage> {
    try {
      const wantsSvg = outputFormat === "svg";

      if (wantsSvg && decoded.kind === "raster") {
        const resizedRaster = this.resizeRaster(decoded, resizeSpec);
        return this.rasterToEmbeddedSvg(resizedRaster);
      }

      if (decoded.kind === "svg" && wantsSvg) {
        return { kind: "svg", svgText: this.resizeSvgDocument(decoded.svgText, resizeSpec) };
      }

      if (decoded.kind === "svg") {
        const rasterised = await this.decodeSvgToRgba(decoded.svgText);
        return this.resizeRaster(rasterised, resizeSpec);
      }

      return this.resizeRaster(decoded, resizeSpec);
    } catch (error) {
      if (error instanceof ImageTransformError) throw error;

      throw new ImageTransformError({
        code: "TRANSFORM_FAILED",
        httpStatus: 500,
        message: "Image transform failed",
        stage: "transform",
        details: {
          outputFormat,
          resize: this.resizeSpecDetails(resizeSpec),
          sourceKind: decoded.kind,
          sourceWidth: decoded.kind === "raster" ? decoded.width : 0,
          sourceHeight: decoded.kind === "raster" ? decoded.height : 0,
        },
        cause: error,
      });
    }
  }

  private resizeSvgDocument(svgText: string, resizeSpec: ResizeSpec): string {
    const wantsResize = Boolean(resizeSpec.width || resizeSpec.height);
    if (!wantsResize) return svgText;

    const intrinsic = this.getSvgIntrinsicSize(svgText);
    const base = this.getSvgBaseSize(intrinsic);
    const target = this.computeTargetSize(base.width, base.height, resizeSpec);

    this.assertPixelBudget(target.width, target.height);

    const normalisedSvg = this.ensureSvgViewBox(svgText, `0 0 ${base.width} ${base.height}`);

    return this.stampSvgSize(normalisedSvg, {
      width: target.width,
      height: target.height,
    });
  }

  private async decodeSvgToRgba(svgText: string): Promise<RasterImage> {
    const intrinsic = this.getSvgIntrinsicSize(svgText);
    const base = this.getSvgBaseSize(intrinsic);

    this.assertPixelBudget(base.width, base.height);

    const normalisedSvg = this.ensureSvgViewBox(svgText, `0 0 ${base.width} ${base.height}`);
    return await this.rasteriseSvgToRgba(normalisedSvg, base.width, base.height);
  }

  private getSvgIntrinsicSize(svgText: string): SvgIntrinsicSize {
    const width = this.parseSvgLength(this.getAttr(svgText, "width"));
    const height = this.parseSvgLength(this.getAttr(svgText, "height"));

    const vb = this.getAttr(svgText, "viewBox");
    const viewBox = vb ? this.parseViewBox(vb) : null;

    return {
      width: width ?? undefined,
      height: height ?? undefined,
      viewBox: viewBox ?? undefined,
    };
  }

  private getSvgBaseSize(intrinsic: SvgIntrinsicSize): { width: number; height: number } {
    if (intrinsic.width && intrinsic.height) {
      return { width: intrinsic.width, height: intrinsic.height };
    }

    if (intrinsic.width && intrinsic.viewBox?.w && intrinsic.viewBox?.h) {
      const height = Math.max(1, Math.round((intrinsic.viewBox.h * intrinsic.width) / intrinsic.viewBox.w));
      return { width: intrinsic.width, height };
    }

    if (intrinsic.height && intrinsic.viewBox?.w && intrinsic.viewBox?.h) {
      const width = Math.max(1, Math.round((intrinsic.viewBox.w * intrinsic.height) / intrinsic.viewBox.h));
      return { width, height: intrinsic.height };
    }

    if (intrinsic.viewBox?.w && intrinsic.viewBox?.h) {
      return {
        width: Math.max(1, Math.round(intrinsic.viewBox.w)),
        height: Math.max(1, Math.round(intrinsic.viewBox.h)),
      };
    }

    return { width: 512, height: 512 };
  }

  private getAttr(svgText: string, name: string): string | null {
    const re = new RegExp(`<svg\\b[^>]*\\s${name}\\s*=\\s*["']([^"']+)["']`, "i");
    const m = svgText.match(re);
    return m?.[1] ?? null;
  }

  private parseViewBox(viewBox: string): { w: number; h: number } | null {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4) return null;

    const w = parts[2];
    const h = parts[3];

    const ok = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
    return ok ? { w, h } : null;
  }

  private parseSvgLength(v: string | null): number | null {
    if (!v) return null;
    const s = v.trim().toLowerCase();

    const m = s.match(/^([0-9]*\.?[0-9]+)(px)?$/);
    if (!m) return null;

    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private ensureSvgViewBox(svgText: string, viewBox: string): string {
    const hasViewBox = /\sviewBox\s*=\s*["'][^"']+["']/i.test(svgText);
    if (hasViewBox) return svgText;

    return svgText.replace(/<svg\b([^>]*)>/i, (full, attrs: string) => {
      return `<svg${attrs} viewBox="${viewBox}">`;
    });
  }

  private async rasteriseSvgToRgba(
    svgText: string,
    width: number,
    height: number,
  ): Promise<RasterImage> {
    const stamped = this.stampSvgSize(svgText, { width, height });

    const fontPath = join(process.cwd(), "data", "fonts", "LiberationSans.ttf");
    const fontFile = readFileSync(fontPath);

    const fontBytes = new Uint8Array(
      fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength),
    );

    const withFontFallback = this.injectTextFallbackCss(stamped, "Liberation Sans");

    const resvg = await ResvgTyped.async(withFontFallback, {
      fitTo: { mode: "original" },
      font: {
        loadSystemFonts: false,
        fontBuffers: [fontBytes],
        defaultFontFamily: "Liberation Sans",
        sansSerifFamily: "Liberation Sans",
        serifFamily: "Liberation Sans",
        monospaceFamily: "Liberation Sans",
        defaultFontSize: 12,
      },
    });

    const pngBytes = resvg.render().asPng();
    const raster = await this.decodePngToRgba(pngBytes);

    if (raster.width === width && raster.height === height) return raster;
    return this.resizeRaster(raster, { width, height });
  }

  private injectTextFallbackCss(svgText: string, family: string): string {
    const marker = "data-imagetx-font-fallback";
    if (svgText.includes(marker)) return svgText;

    const css = `text, tspan { font-family: "${family}", sans-serif !important; }`;
    const styleTag = `<style ${marker}="1"><![CDATA[${css}]]></style>`;

    return svgText.replace(/<svg\b([^>]*)>/i, (full, attrs: string) => `<svg${attrs}>${styleTag}`);
  }

  private resizeRaster(image: RasterImage, resizeSpec: ResizeSpec): RasterImage {
    const target = this.computeTargetSize(image.width, image.height, resizeSpec);
    const isAlreadyRight = target.width === image.width && target.height === image.height;
    if (isAlreadyRight) return image;

    this.assertPixelBudget(target.width, target.height);

    return {
      kind: "raster",
      width: target.width,
      height: target.height,
      rgba: this.resizeRgbaBilinear(image.rgba, image.width, image.height, target.width, target.height),
    };
  }

  private resizeRgbaBilinear(
    source: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
  ): Uint8Array {
    const target = new Uint8Array(targetWidth * targetHeight * 4);

    const xRatio = targetWidth > 1
      ? (sourceWidth - 1) / (targetWidth - 1)
      : 0;

    const yRatio = targetHeight > 1
      ? (sourceHeight - 1) / (targetHeight - 1)
      : 0;

    for (let y = 0; y < targetHeight; y++) {
      const sourceY = y * yRatio;
      const y0 = Math.floor(sourceY);
      const y1 = Math.min(y0 + 1, sourceHeight - 1);
      const yWeight = sourceY - y0;

      for (let x = 0; x < targetWidth; x++) {
        const sourceX = x * xRatio;
        const x0 = Math.floor(sourceX);
        const x1 = Math.min(x0 + 1, sourceWidth - 1);
        const xWeight = sourceX - x0;

        const targetIndex = (y * targetWidth + x) * 4;
        const topLeftIndex = (y0 * sourceWidth + x0) * 4;
        const topRightIndex = (y0 * sourceWidth + x1) * 4;
        const bottomLeftIndex = (y1 * sourceWidth + x0) * 4;
        const bottomRightIndex = (y1 * sourceWidth + x1) * 4;

        for (let channel = 0; channel < 4; channel++) {
          const topLeft = source[topLeftIndex + channel];
          const topRight = source[topRightIndex + channel];
          const bottomLeft = source[bottomLeftIndex + channel];
          const bottomRight = source[bottomRightIndex + channel];

          const top = topLeft + (topRight - topLeft) * xWeight;
          const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
          target[targetIndex + channel] = Math.round(top + (bottom - top) * yWeight);
        }
      }
    }

    return target;
  }

  private computeTargetSize(srcW: number, srcH: number, spec: ResizeSpec): { width: number; height: number } {
    const w = spec.width;
    const h = spec.height;

    if (!w && !h) return { width: srcW, height: srcH };
    if (w && h) return { width: w, height: h };

    if (w) {
      const scaledH = Math.max(1, Math.round((srcH * w) / srcW));
      return { width: w, height: scaledH };
    }

    const hh = h as number;
    const scaledW = Math.max(1, Math.round((srcW * hh) / srcH));
    return { width: scaledW, height: hh };
  }

  private async encodeOutput(
    image: DecodedImage,
    format: SupportedFormat,
  ): Promise<{ body: Uint8Array; contentType: string }> {
    try {
      switch (format) {
        case "svg": {
          if (image.kind !== "svg") throw new Error("Internal: expected svg output");
          const body = new TextEncoder().encode(image.svgText);
          return { body, contentType: "image/svg+xml" };
        }
        case "png": {
          this.assertRaster(image);
          const body = encodePng(image.rgba, image.width, image.height);
          return { body, contentType: "image/png" };
        }
        case "jpg":
        case "jpeg": {
          this.assertRaster(image);
          const flattened = this.flattenAlphaOverWhite(image.rgba);
          const encoded = jpeg.encode(
            {
              data: Buffer.from(flattened),
              width: image.width,
              height: image.height,
            },
            this.encodeOptions.jpegQuality,
          );

          return { body: new Uint8Array(encoded.data), contentType: "image/jpeg" };
        }
        case "bmp": {
          this.assertRaster(image);
          const rgb = this.dropAlpha(image.rgba);
          const encoded = BMP.encode({
            data: Buffer.from(rgb),
            width: image.width,
            height: image.height,
          });
          return { body: new Uint8Array(encoded.data), contentType: "image/bmp" };
        }
        case "tif":
        case "tiff": {
          this.assertRaster(image);
          const rgba = this.copyViewToUint8Array(image.rgba);
          const ifd = UTIF.encodeImage(rgba, image.width, image.height);
          const tiff = UTIF.encode([ifd]) as ArrayBuffer;
          return { body: new Uint8Array(tiff), contentType: "image/tiff" };
        }
        case "gif": {
          this.assertRaster(image);
          const body = this.encodeGifSingleFrame(image);
          return { body, contentType: "image/gif" };
        }
        case "webp":
          throw new Error("Internal: webp should be passed through without encoding");
      }
    } catch (error: unknown) {
      if (error instanceof ImageTransformError) throw error;

      const message = error instanceof Error ? error.message : `Encode failed with non-Error value: ${String(error)}`;

      throw new ImageTransformError({
        code: "ENCODE_FAILED",
        httpStatus: 500,
        message: `Encode failed while encoding ${format}: ${message}`,
        stage: "encode",
        details: {
          format,
          sourceKind: image.kind,
          sourceWidth: image.kind === "raster" ? image.width : 0,
          sourceHeight: image.kind === "raster" ? image.height : 0,
        },
        cause: error,
      });
    }
  }

  private assertRaster(image: DecodedImage): asserts image is RasterImage {
    if (image.kind === "raster") return;
    throw new Error("Internal: expected raster output");
  }

  private encodeGifSingleFrame(img: RasterImage): Uint8Array {
    const rgba = this.copyViewToUint8Array(img.rgba);

    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3];
      if (a <= 127) {
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
      } else {
        rgba[i + 3] = 255;
      }
    }

    const paletteBody = quantize(rgba, 255, {
      format: "rgba4444",
      oneBitAlpha: true,
      clearAlpha: true,
      clearAlphaColor: 0x00,
    });

    const palette = [[0, 0, 0, 0], ...paletteBody];
    const index = applyPalette(rgba, palette, "rgba4444");
    const gif = GIFEncoder();

    gif.writeFrame(index, img.width, img.height, {
      palette,
      transparent: true,
      transparentIndex: 0,
    });

    gif.finish();
    return gif.bytes();
  }

  private stampSvgSize(svgText: string, spec: ResizeSpec): string {
    const hasSize = Boolean(spec.width || spec.height);
    if (!hasSize) return svgText;

    const w = spec.width ? `${spec.width}` : null;
    const h = spec.height ? `${spec.height}` : null;

    return svgText.replace(/<svg\b([^>]*)>/i, (full, attrs: string) => {
      const withWidth = this.upsertAttr(attrs, "width", w);
      const withHeight = this.upsertAttr(withWidth, "height", h);
      return `<svg${withHeight}>`;
    });
  }

  private upsertAttr(attrs: string, name: string, value: string | null): string {
    if (!value) return attrs;

    const re = new RegExp(`\\s${name}\\s*=\\s*["'][^"']*["']`, "i");
    if (re.test(attrs)) return attrs.replace(re, ` ${name}="${value}"`);

    return `${attrs} ${name}="${value}"`;
  }

  private rasterToEmbeddedSvg(img: RasterImage): SvgImage {
    const png = encodePng(img.rgba, img.width, img.height);
    const b64 = Buffer.from(png).toString("base64");

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}" viewBox="0 0 ${img.width} ${img.height}">` +
      `<image width="${img.width}" height="${img.height}" href="data:image/png;base64,${b64}" />` +
      `</svg>`;

    return { kind: "svg", svgText: svg };
  }

  private flattenAlphaOverWhite(rgba: Uint8Array): Uint8Array {
    const out = new Uint8Array(rgba.length);

    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3] / 255;

      out[i] = Math.round(r * a + 255 * (1 - a));
      out[i + 1] = Math.round(g * a + 255 * (1 - a));
      out[i + 2] = Math.round(b * a + 255 * (1 - a));
      out[i + 3] = 255;
    }

    return out;
  }

  private dropAlpha(rgba: Uint8Array): Uint8Array {
    const out = new Uint8Array((rgba.length / 4) * 3);
    let j = 0;

    for (let i = 0; i < rgba.length; i += 4) {
      out[j++] = rgba[i];
      out[j++] = rgba[i + 1];
      out[j++] = rgba[i + 2];
    }

    return out;
  }

  private blitRgba(
    dst: Uint8Array,
    dstW: number,
    dstH: number,
    src: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    left: number,
    top: number,
  ): void {
    for (let y = 0; y < srcH; y++) {
      const dy = top + y;
      const yOutOfBounds = dy < 0 || dy >= dstH;
      if (yOutOfBounds) continue;

      for (let x = 0; x < srcW; x++) {
        const dx = left + x;
        const xOutOfBounds = dx < 0 || dx >= dstW;
        if (xOutOfBounds) continue;

        const si = (y * srcW + x) * 4;
        const di = (dy * dstW + dx) * 4;

        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = src[si + 3];
      }
    }
  }

  private toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  private copyViewToUint8Array(view: ArrayBufferView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  private cacheKeyFromRemoteRequest(args: {
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

  private async ensureCacheDir(): Promise<void> {
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

  private async readCacheIndex(): Promise<CacheIndex> {
    await this.ensureCacheDir();

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

  private async writeCacheIndex(index: CacheIndex): Promise<void> {
    await this.ensureCacheDir();

    const tmpPath = `${IMAGE_CACHE_INDEX_PATH}.tmp`;
    const body = JSON.stringify(index, null, 2);

    try {
      await fs.promises.writeFile(tmpPath, body, "utf-8");
      await fs.promises.rename(tmpPath, IMAGE_CACHE_INDEX_PATH);
    } catch (error) {
      console.error(`Failed to write cache index ${IMAGE_CACHE_INDEX_PATH}:`, error);
    }
  }

  private async purgeExpiredCacheEntries(index: CacheIndex): Promise<boolean> {
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

  private async tryLoadFromCache(args: {
    kind: "remote";
    srcUrl: string;
    outputFormat: SupportedFormat;
    resize: ResizeSpec;
    detectedSrcFormatHint: SupportedFormat;
  }): Promise<TransformResult | null> {
    const key = this.cacheKeyFromRemoteRequest(args);
    const index = await this.readCacheIndex();

    const changed = await this.purgeExpiredCacheEntries(index);
    if (changed) await this.writeCacheIndex(index);

    const entry = index[key];
    if (!entry) return null;

    const filePath = join(IMAGE_CACHE_DIR, entry.fileName);

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await fs.promises.readFile(filePath));
    } catch {
      delete index[key];
      await this.writeCacheIndex(index);
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

  private extensionForContentType(contentType: string): string {
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

  private async saveToCache(
    args: {
      kind: "remote";
      srcUrl: string;
      outputFormat: SupportedFormat;
      resize: ResizeSpec;
      detectedSrcFormatHint: SupportedFormat;
    },
    result: TransformResult,
  ): Promise<void> {
    const key = this.cacheKeyFromRemoteRequest(args);
    const index = await this.readCacheIndex();

    const ext = this.extensionForContentType(result.contentType);
    const fileName = `${key}.${ext}`;
    const filePath = join(IMAGE_CACHE_DIR, fileName);

    try {
      await this.ensureCacheDir();
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

    await this.writeCacheIndex(index);
  }

  private headersToJsonObject(headers: Headers): ImageTransformErrorDetails {
    const out: ImageTransformErrorDetails = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  private sourceDetails(srcUrl: URL): ImageTransformErrorDetails {
    return {
      srcUrl: srcUrl.toString(),
      protocol: srcUrl.protocol,
      hostname: srcUrl.hostname,
      pathname: srcUrl.pathname,
    };
  }

  private resizeSpecDetails(spec: ResizeSpec): ImageTransformErrorDetails {
    return {
      width: spec.width ?? null,
      height: spec.height ?? null,
    };
  }

  private firstBytesHex(bytes: Uint8Array): string {
    return Buffer.from(bytes.slice(0, 32)).toString("hex");
  }
}