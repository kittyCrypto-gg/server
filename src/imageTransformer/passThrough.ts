import type { TransformerContext } from "./context";
import type { SupportedFormat, ResizeSpec, TransformResult } from "./types";
import { ImageTransformError } from "./errors";
import { GifReader } from "omggif";

export function passThroughWebp(
    ctx: TransformerContext,
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
          resize: ctx.resizeSpecDetails(input.resize ?? {}),
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

export function passThroughGif(
    ctx: TransformerContext,
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
          resize: ctx.resizeSpecDetails(input.resize ?? {}),
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
          firstBytesHex: ctx.firstBytesHex(bytes),
        },
        cause: error,
      });
    }
}
