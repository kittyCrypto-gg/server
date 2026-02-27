// src/ImageTransformer.ts
import { decode as decodePng, encode as encodePng } from "@cf-wasm/png";
/* @ts-ignore */
import { Resvg } from "@cf-wasm/resvg/node";
import { decode as decodeJpeg, encode as encodeJpeg } from "@jsquash/jpeg";
import resizeRgba from "@jsquash/resize";
import { GifReader } from "omggif";
import { parseGIF, decompressFrames } from "gifuct-js";
import * as BMP from "bmp-js";
/* @ts-ignore */
import * as UTIF from "utif";
/* @ts-ignore */
import { GIFEncoder, quantize, applyPalette } from "gifenc";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ALLOWED_IMAGE_SOURCE_HOSTS = new Set<string>([
  "kittycrypto.gg",
]);

function isAllowedImageSourceUrl(u: URL): boolean {
  if (u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();
  if (host.endsWith(".kittycrypto.gg")) return true;

  return ALLOWED_IMAGE_SOURCE_HOSTS.has(host);
}

export type SupportedFormat = "svg" | "png" | "gif" | "bmp" | "jpg" | "jpeg" | "tiff" | "tif";

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
  | "ENCODE_FAILED"
  | "INTERNAL";

export class ImageTransformError extends Error {
  public readonly code: TransformErrorCode;
  public readonly httpStatus: number;

  public constructor(code: TransformErrorCode, httpStatus: number, message: string) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
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

// Resvg import is ts-ignored, so give it a safe shape without using `any`.
const ResvgTyped = Resvg as unknown as ResvgStatic;

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
    const srcUrl = this.resolveSrcUrl(input.src, input.baseUrl);

    if (!isAllowedImageSourceUrl(srcUrl)) {
      throw new ImageTransformError(
        "BAD_REQUEST",
        403,
        `Source not allowed: ${srcUrl.hostname}`,
      );
    }

    const response = await fetch(srcUrl.toString(), {
      headers: {
        Accept: "image/*,application/octet-stream;q=0.9,*/*;q=0.1",
        ...(input.requestHeaders ?? {}),
      },
    });

    if (!response.ok) {
      throw new ImageTransformError("FETCH_FAILED", 502, `Failed to fetch src (${response.status})`);
    }

    const srcBytes = new Uint8Array(await response.arrayBuffer());
    this.assertByteBudget(srcBytes.byteLength);

    const detectedSrcFormat =
      input.srcFormatHint ??
      this.detectFormatFromHeaders(response.headers) ??
      this.detectFormatFromUrl(srcUrl) ??
      this.detectFormatFromMagicBytes(srcBytes);

    if (!detectedSrcFormat) {
      throw new ImageTransformError(
        "BAD_REQUEST",
        400,
        "Could not determine source format. Provide srcFormatHint=png|jpg|svg|...",
      );
    }

    const outputFormat = input.format ?? detectedSrcFormat;

    this.assertSupportedFormat(detectedSrcFormat, "input");
    this.assertSupportedFormat(outputFormat, "output");

    const decoded = await this.decodeImage(detectedSrcFormat, srcBytes);
    const resized = await this.transform(decoded, input.resize ?? {}, outputFormat);
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

  public async transformBytes(input: TransformBytesInput): Promise<TransformResult> {
    this.assertByteBudget(input.bytes.byteLength);

    const urlHint = input.originalUrlHint ? new URL(input.originalUrlHint) : null;

    const detectedSrcFormat =
      input.srcFormatHint ??
      (input.contentTypeHint ? this.detectFormatFromContentType(input.contentTypeHint) : null) ??
      (urlHint ? this.detectFormatFromUrl(urlHint) : null) ??
      this.detectFormatFromMagicBytes(input.bytes);

    if (!detectedSrcFormat) {
      throw new ImageTransformError(
        "BAD_REQUEST",
        400,
        "Could not determine source format. Provide srcFormatHint=png|jpg|svg|...",
      );
    }

    const outputFormat = input.format ?? detectedSrcFormat;

    this.assertSupportedFormat(detectedSrcFormat, "input");
    this.assertSupportedFormat(outputFormat, "output");

    const decoded = await this.decodeImage(detectedSrcFormat, input.bytes);
    const resized = await this.transform(decoded, input.resize ?? {}, outputFormat);
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

  private getDecodedSize(image: DecodedImage): { width: number; height: number } {
    if (image.kind === "svg") return { width: 0, height: 0 };
    return { width: image.width, height: image.height };
  }

  private resolveSrcUrl(src: string, baseUrl?: string): URL {
    const base = baseUrl ? new URL(baseUrl) : undefined;
    return base ? new URL(src, base) : new URL(src);
  }

  private assertByteBudget(byteLength: number): void {
    if (byteLength <= this.limits.maxSrcBytes) return;
    throw new ImageTransformError("PAYLOAD_TOO_LARGE", 400, "src is too large");
  }

  private assertPixelBudget(w: number, h: number): void {
    const pixels = w * h;
    if (pixels <= this.limits.maxPixels) return;
    throw new ImageTransformError("IMAGE_TOO_LARGE", 400, `Image too large: ${w}x${h} (${pixels} pixels)`);
  }

  private assertSupportedFormat(format: string, side: "input" | "output"): void {
    if (this.isSupportedFormat(format)) return;
    throw new ImageTransformError("UNSUPPORTED_FORMAT", 400, `Unsupported ${side} format: ${format}`);
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
    };

    return map[ct] ?? null;
  }

  private detectFormatFromUrl(u: URL): SupportedFormat | null {
    const path = u.pathname.toLowerCase();
    const dot = path.lastIndexOf(".");
    if (dot < 0) return null;
    return this.normaliseFormat(path.slice(dot + 1));
  }

  private detectFormatFromMagicBytes(bytes: Uint8Array): SupportedFormat | null {
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
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown decode error";
      throw new ImageTransformError("DECODE_FAILED", 400, message);
    }
  }

  private async decodePngToRgba(bytes: Uint8Array): Promise<RasterImage> {
    const decoded = decodePng(bytes);
    const rgba = decoded.image instanceof Uint8Array ? decoded.image : new Uint8Array(decoded.image);
    this.assertPixelBudget(decoded.width, decoded.height);
    return { kind: "raster", width: decoded.width, height: decoded.height, rgba };
  }

  private async decodeJpegToRgba(bytes: Uint8Array): Promise<RasterImage> {
    const ab = this.toExactArrayBuffer(bytes);
    const decoded = await decodeJpeg(ab);
    const rgba = new Uint8Array(decoded.data.buffer.slice(0));
    this.assertPixelBudget(decoded.width, decoded.height);
    return { kind: "raster", width: decoded.width, height: decoded.height, rgba };
  }

  private async decodeBmpToRgba(bytes: Uint8Array): Promise<RasterImage> {
    const bmp = BMP.decode(Buffer.from(bytes));
    const rgba = new Uint8Array(bmp.data.buffer.slice(0));
    this.assertPixelBudget(bmp.width, bmp.height);
    return { kind: "raster", width: bmp.width, height: bmp.height, rgba };
  }

  private async decodeTiffToRgba(bytes: Uint8Array): Promise<RasterImage> {
    const ab = this.toExactArrayBuffer(bytes);
    const ifds = UTIF.decode(ab);
    if (!ifds.length) throw new Error("TIFF decode produced no images");

    UTIF.decodeImage(ab, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]) as Uint8Array;

    const width = Number(ifds[0].width ?? 0);
    const height = Number(ifds[0].height ?? 0);

    if (!width || !height) throw new Error("TIFF missing width/height");
    this.assertPixelBudget(width, height);

    return { kind: "raster", width, height, rgba };
  }

  private async decodeGifToRgba(bytes: Uint8Array): Promise<RasterImage> {
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
    } catch {
      const reader = new GifReader(Buffer.from(bytes));
      const w = reader.width;
      const h = reader.height;
      this.assertPixelBudget(w, h);
      const rgba = new Uint8Array(w * h * 4);
      reader.decodeAndBlitFrameRGBA(0, rgba);
      return { kind: "raster", width: w, height: h, rgba };
    }
  }

  private async transform(decoded: DecodedImage, resizeSpec: ResizeSpec, outputFormat: SupportedFormat): Promise<DecodedImage> {
    const wantsSvg = outputFormat === "svg";

    if (wantsSvg && decoded.kind === "raster") {
      const resizedRaster = await this.resizeRaster(decoded, resizeSpec);
      return this.rasterToEmbeddedSvg(resizedRaster);
    }

    if (decoded.kind === "svg" && wantsSvg) {
      return { kind: "svg", svgText: this.stampSvgSize(decoded.svgText, resizeSpec) };
    }

    if (decoded.kind === "svg") {
      const intrinsic = this.getSvgIntrinsicSize(decoded.svgText);
      const target = this.computeTargetSizeFromSvg(intrinsic, resizeSpec);

      this.assertPixelBudget(target.width, target.height);

      const rasterised = await this.rasteriseSvgToRgba(decoded.svgText, target.width, target.height);
      return rasterised;
    }

    return await this.resizeRaster(decoded, resizeSpec);
  }

  private typeSvgIntrinsicSize(): void {
    // purely to keep the type near the methods in editors
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

  private computeTargetSizeFromSvg(intrinsic: SvgIntrinsicSize, spec: ResizeSpec): { width: number; height: number } {
    const base = this.getSvgBaseSize(intrinsic);

    const w = spec.width;
    const h = spec.height;

    if (w && h) return { width: w, height: h };

    if (w) {
      const scaledH = Math.max(1, Math.round((base.height * w) / base.width));
      return { width: w, height: scaledH };
    }

    if (h) {
      const scaledW = Math.max(1, Math.round((base.width * h) / base.height));
      return { width: scaledW, height: h };
    }

    return base;
  }

  private getSvgBaseSize(intrinsic: SvgIntrinsicSize): { width: number; height: number } {
    if (intrinsic.width && intrinsic.height) return { width: intrinsic.width, height: intrinsic.height };

    if (intrinsic.viewBox?.w && intrinsic.viewBox?.h) {
      return {
        width: Math.max(1, Math.round(intrinsic.viewBox.w)),
        height: Math.max(1, Math.round(intrinsic.viewBox.h)),
      };
    }

    return { width: 512, height: 512 };
  }

  private getAttr(svgText: string, name: string): string | null {
    const re = new RegExp(`<svg\\b[^>]*\\s${name}="([^"]+)"`, "i");
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

  private async rasteriseSvgToRgba(svgText: string, width: number, height: number): Promise<RasterImage> {
    const stamped = this.stampSvgSize(svgText, { width, height });

    // Make the font path stable regardless of where the process is launched from.
    const fontPath = join(process.cwd(), "data", "fonts", "LiberationSans.ttf");
    const fontFile = readFileSync(fontPath);

    // Ensure it's an exact Uint8Array view over the font bytes (no extra capacity).
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
    return await this.resizeRaster(raster, { width, height });
  }

  private injectTextFallbackCss(svgText: string, family: string): string {
    const marker = "data-imagetx-font-fallback";
    if (svgText.includes(marker)) return svgText;

    const css = `text, tspan { font-family: "${family}", sans-serif !important; }`;
    const styleTag = `<style ${marker}="1"><![CDATA[${css}]]></style>`;

    return svgText.replace(/<svg\b([^>]*)>/i, (full, attrs: string) => `<svg${attrs}>${styleTag}`);
  }

  private async resizeRaster(image: RasterImage, resizeSpec: ResizeSpec): Promise<RasterImage> {
    const target = this.computeTargetSize(image.width, image.height, resizeSpec);
    const isAlreadyRight = target.width === image.width && target.height === image.height;
    if (isAlreadyRight) return image;

    this.assertPixelBudget(target.width, target.height);

    const resized = await resizeRgba(
      {
        data: new Uint8ClampedArray(image.rgba),
        width: image.width,
        height: image.height,
        colorSpace: "srgb",
      },
      {
        width: target.width,
        height: target.height,
      },
    );

    return {
      kind: "raster",
      width: resized.width,
      height: resized.height,
      rgba: new Uint8Array(resized.data.buffer.slice(0)),
    };
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
          const buffer = this.toExactArrayBuffer(flattened);
          const encoded = await encodeJpeg(
            {
              data: new Uint8ClampedArray(buffer),
              width: image.width,
              height: image.height,
              colorSpace: "srgb",
            },
            { quality: this.encodeOptions.jpegQuality },
          );
          return { body: new Uint8Array(encoded), contentType: "image/jpeg" };
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
          const rgba = new Uint8Array(image.rgba.buffer.slice(0));
          const ifd = UTIF.encodeImage(rgba, image.width, image.height);
          const tiff = UTIF.encode([ifd]) as ArrayBuffer;
          return { body: new Uint8Array(tiff), contentType: "image/tiff" };
        }
        case "gif": {
          this.assertRaster(image);
          const body = this.encodeGifSingleFrame(image);
          return { body, contentType: "image/gif" };
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown encode error";
      throw new ImageTransformError("ENCODE_FAILED", 500, message);
    }
  }

  private assertRaster(image: DecodedImage): asserts image is RasterImage {
    if (image.kind === "raster") return;
    throw new Error("Internal: expected raster output");
  }

  private encodeGifSingleFrame(img: RasterImage): Uint8Array {
    const rgba = new Uint8Array(img.rgba.buffer.slice(0));

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
      const nextAttrs = this.upsertAttr(this.upsertAttr(attrs, "width", w), "height", h);
      return `<svg${nextAttrs}>`;
    });
  }

  private upsertAttr(attrs: string, name: string, value: string | null): string {
    if (!value) return attrs;
    const re = new RegExp(`\\s${name}="[^"]*"`, "i");
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
}

type SvgIntrinsicSize = {
  width?: number;
  height?: number;
  viewBox?: { w: number; h: number };
};