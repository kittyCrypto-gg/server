import type { TransformerContext } from "./context";
import type { SupportedFormat, ResizeSpec, RasterImage, SvgImage, DecodedImage, TransformRemoteUrlInput, TransformBytesInput, TransformResult, TransformerLimits, TransformerEncodeOptions, ImageTransformerOptions, TransformErrorCode, TransformErrorStage, ImageTransformErrorDetails, UnknownErrorSummary, ImageTransformErrorBody, ResvgRenderOptions, ResvgInstance, ResvgStatic, CacheIndexEntry, CacheIndex, SvgIntrinsicSize } from "./types";
import { ImageTransformError } from "./errors";
import { isAllowedImageSourceUrl } from "./sourcePolicy";

export async function transformRemoteUrl(ctx: TransformerContext, input: TransformRemoteUrlInput): Promise<TransformResult> {
    const srcUrl = ctx.resolveSrcUrlWithDetail(input.src, input.baseUrl);

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
        details: ctx.sourceDetails(srcUrl),
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
          ...ctx.sourceDetails(srcUrl),
          reason: "The source host is not present in the image source allowlist",
        },
      });
    }

    const resizeSpec = input.resize ?? {};
    const wantsResize = Boolean(resizeSpec.width || resizeSpec.height);
    const response = await ctx.fetchRemoteSource(srcUrl, input.requestHeaders);
    const srcBytes = await ctx.readResponseBytes(response, srcUrl);

    ctx.assertByteBudget(srcBytes.byteLength, {
      stage: "read-source-body",
      ...ctx.sourceDetails(srcUrl),
    });

    const detectedSrcFormat =
      input.srcFormatHint ??
      ctx.detectFormatFromHeaders(response.headers) ??
      ctx.detectFormatFromUrl(srcUrl) ??
      ctx.detectFormatFromMagicBytes(srcBytes);

    if (!detectedSrcFormat) {
      throw new ImageTransformError({
        code: "BAD_REQUEST",
        httpStatus: 400,
        message: "Could not determine source image format",
        stage: "detect-source-format",
        details: {
          ...ctx.sourceDetails(srcUrl),
          contentType: response.headers.get("content-type") ?? null,
          byteLength: srcBytes.byteLength,
          firstBytesHex: ctx.firstBytesHex(srcBytes),
          suggestion: "Provide srcFormatHint=png|jpg|svg|gif|bmp|tif|tiff|webp",
        },
      });
    }

    const outputFormat = input.format ?? detectedSrcFormat;
    const isPassThroughWebp = detectedSrcFormat === "webp";
    const isPassThroughGif = detectedSrcFormat === "gif" && outputFormat === "gif" && !wantsResize;

    if (isPassThroughWebp) {
      return ctx.passThroughWebp(input, srcBytes, detectedSrcFormat);
    }

    if (isPassThroughGif) {
      return ctx.passThroughGif(input, srcBytes, detectedSrcFormat);
    }

    if (!input.nocache && !input.refresh) {
      const cached = await ctx.tryLoadFromCache({
        kind: "remote",
        srcUrl: srcUrl.toString(),
        outputFormat,
        resize: resizeSpec,
        detectedSrcFormatHint: detectedSrcFormat,
      });

      if (cached) return cached;
    }

    ctx.assertSupportedFormat(detectedSrcFormat, "input");
    ctx.assertSupportedFormat(outputFormat, "output");

    const decoded = await ctx.decodeImage(detectedSrcFormat, srcBytes);
    const resized = await ctx.transform(decoded, resizeSpec, outputFormat);
    const encoded = await ctx.encodeOutput(resized, outputFormat);
    const size = ctx.getDecodedSize(resized);

    const result: TransformResult = {
      body: encoded.body,
      contentType: encoded.contentType,
      outputFormat,
      detectedSrcFormat,
      width: size.width,
      height: size.height,
    };

    if (!input.nocache) {
      await ctx.saveToCache({
        kind: "remote",
        srcUrl: srcUrl.toString(),
        outputFormat,
        resize: resizeSpec,
        detectedSrcFormatHint: detectedSrcFormat,
      }, result);
    }

    return result;
}

export async function transformBytes(ctx: TransformerContext, input: TransformBytesInput): Promise<TransformResult> {
    ctx.assertByteBudget(input.bytes.byteLength, {
      stage: "read-source-body",
      source: "bytes-input",
    });

    const urlHint = ctx.parseOptionalUrlHint(input.originalUrlHint);

    const detectedSrcFormat =
      input.srcFormatHint ??
      (input.contentTypeHint ? ctx.detectFormatFromContentType(input.contentTypeHint) : null) ??
      (urlHint ? ctx.detectFormatFromUrl(urlHint) : null) ??
      ctx.detectFormatFromMagicBytes(input.bytes);

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
          firstBytesHex: ctx.firstBytesHex(input.bytes),
          suggestion: "Provide srcFormatHint=png|jpg|svg|gif|bmp|tif|tiff|webp",
        },
      });
    }

    const outputFormat = input.format ?? detectedSrcFormat;
    const resizeSpec = input.resize ?? {};
    const wantsResize = Boolean(resizeSpec.width || resizeSpec.height);

    if (detectedSrcFormat === "webp") {
      return ctx.passThroughWebp(input, input.bytes, detectedSrcFormat);
    }

    if (detectedSrcFormat === "gif" && outputFormat === "gif" && !wantsResize) {
      return ctx.passThroughGif(input, input.bytes, detectedSrcFormat);
    }

    ctx.assertSupportedFormat(detectedSrcFormat, "input");
    ctx.assertSupportedFormat(outputFormat, "output");

    const decoded = await ctx.decodeImage(detectedSrcFormat, input.bytes);
    const resized = await ctx.transform(decoded, resizeSpec, outputFormat);
    const encoded = await ctx.encodeOutput(resized, outputFormat);
    const size = ctx.getDecodedSize(resized);

    return {
      body: encoded.body,
      contentType: encoded.contentType,
      outputFormat,
      detectedSrcFormat,
      width: size.width,
      height: size.height,
    };
}
