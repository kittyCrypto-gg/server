import type { TransformerContext } from "./context";
import type { SupportedFormat, ResizeSpec, RasterImage, SvgImage, DecodedImage, TransformRemoteUrlInput, TransformBytesInput, TransformResult, TransformerLimits, TransformerEncodeOptions, ImageTransformerOptions, TransformErrorCode, TransformErrorStage, ImageTransformErrorDetails, UnknownErrorSummary, ImageTransformErrorBody, ResvgRenderOptions, ResvgInstance, ResvgStatic, CacheIndexEntry, CacheIndex, SvgIntrinsicSize } from "./types";
import { ImageTransformError } from "./errors";
import { decode as decodePng, encode as encodePng } from "@cf-wasm/png";
import * as jpeg from "jpeg-js";
import { parseGIF, decompressFrames } from "gifuct-js";
import { GifReader } from "omggif";
import * as BMP from "bmp-js";
import * as UTIF from "utif";

export async function decodeImage(ctx: TransformerContext, format: SupportedFormat, bytes: Uint8Array): Promise<DecodedImage> {
    try {
      switch (format) {
        case "svg": {
          const svgText = new TextDecoder("utf-8").decode(bytes);
          return { kind: "svg", svgText };
        }
        case "png":
          return await ctx.decodePngToRgba(bytes);
        case "jpg":
        case "jpeg":
          return await ctx.decodeJpegToRgba(bytes);
        case "bmp":
          return await ctx.decodeBmpToRgba(bytes);
        case "tif":
        case "tiff":
          return await ctx.decodeTiffToRgba(bytes);
        case "gif":
          return await ctx.decodeGifToRgba(bytes);
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
          firstBytesHex: ctx.firstBytesHex(bytes),
        },
        cause: error,
      });
    }
}

export function expandToRgba(ctx: TransformerContext, raw: Uint8Array, width: number, height: number, format: SupportedFormat): Uint8Array {
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

export async function decodePngToRgba(ctx: TransformerContext, bytes: Uint8Array): Promise<RasterImage> {
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
          firstBytesHex: ctx.firstBytesHex(bytes),
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

    ctx.assertPixelBudget(decoded.width, decoded.height);

    const rgba = ctx.expandToRgba(raw, decoded.width, decoded.height, "png");
    return { kind: "raster", width: decoded.width, height: decoded.height, rgba };
}

export async function decodeJpegToRgba(ctx: TransformerContext, bytes: Uint8Array): Promise<RasterImage> {
    try {
      const decoded = jpeg.decode(Buffer.from(bytes), {
        useTArray: true,
      });

      const rgba = ctx.copyViewToUint8Array(decoded.data);
      ctx.assertPixelBudget(decoded.width, decoded.height);

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
          firstBytesHex: ctx.firstBytesHex(bytes),
          decoder: "jpeg-js",
        },
        cause: error,
      });
    }
}

export async function decodeBmpToRgba(ctx: TransformerContext, bytes: Uint8Array): Promise<RasterImage> {
    try {
      const bmp = BMP.decode(Buffer.from(bytes));
      const rgba = ctx.copyViewToUint8Array(bmp.data);
      ctx.assertPixelBudget(bmp.width, bmp.height);

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
          firstBytesHex: ctx.firstBytesHex(bytes),
        },
        cause: error,
      });
    }
}

export async function decodeTiffToRgba(ctx: TransformerContext, bytes: Uint8Array): Promise<RasterImage> {
    const ab = ctx.toExactArrayBuffer(bytes);

    try {
      const ifds = UTIF.decode(ab);
      if (!ifds.length) throw new Error("TIFF decode produced no images");

      UTIF.decodeImage(ab, ifds[0]);
      const rgba = UTIF.toRGBA8(ifds[0]) as Uint8Array;

      const width = Number(ifds[0].width ?? 0);
      const height = Number(ifds[0].height ?? 0);

      if (!width || !height) throw new Error("TIFF missing width/height");
      ctx.assertPixelBudget(width, height);

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
          firstBytesHex: ctx.firstBytesHex(bytes),
        },
        cause: error,
      });
    }
}

export async function decodeGifToRgba(ctx: TransformerContext, bytes: Uint8Array): Promise<RasterImage> {
    let firstDecoderError: unknown = null;

    try {
      const ab = ctx.toExactArrayBuffer(bytes);
      const parsed = parseGIF(ab);
      const frames = decompressFrames(parsed, true);
      if (!frames.length) throw new Error("GIF has no frames");

      const w = parsed.lsd.width;
      const h = parsed.lsd.height;
      ctx.assertPixelBudget(w, h);

      const canvas = new Uint8Array(w * h * 4);
      const f0 = frames[0];

      ctx.blitRgba(canvas, w, h, f0.patch, f0.dims.width, f0.dims.height, f0.dims.left, f0.dims.top);

      return { kind: "raster", width: w, height: h, rgba: canvas };
    } catch (error) {
      firstDecoderError = error;
    }

    try {
      const reader = new GifReader(Buffer.from(bytes));
      const w = reader.width;
      const h = reader.height;
      ctx.assertPixelBudget(w, h);
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
          firstBytesHex: ctx.firstBytesHex(bytes),
          primaryDecoder: "gifuct-js",
          fallbackDecoder: "omggif",
          primaryDecoderError: summariseUnknownError(firstDecoderError, false).message,
        },
        cause: error,
      });
    }
}
