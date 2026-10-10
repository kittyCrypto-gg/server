import { describe, expect, test } from "bun:test";
import { ImageTransformer, ImageTransformError } from "../src/imageTransformer";

const originalPrivateMethods = [
  "resolveSrcUrlWithDetail",
  "parseOptionalUrlHint",
  "fetchRemoteSource",
  "readResponseBytes",
  "passThroughWebp",
  "passThroughGif",
  "getDecodedSize",
  "resolveSrcUrl",
  "assertByteBudget",
  "assertPixelBudget",
  "assertSupportedFormat",
  "normaliseFormat",
  "isSupportedFormat",
  "detectFormatFromHeaders",
  "detectFormatFromContentType",
  "detectFormatFromUrl",
  "detectFormatFromMagicBytes",
  "decodeImage",
  "expandToRgba",
  "decodePngToRgba",
  "decodeJpegToRgba",
  "decodeBmpToRgba",
  "decodeTiffToRgba",
  "decodeGifToRgba",
  "transform",
  "resizeSvgDocument",
  "decodeSvgToRgba",
  "getSvgIntrinsicSize",
  "getSvgBaseSize",
  "getAttr",
  "parseViewBox",
  "parseSvgLength",
  "ensureSvgViewBox",
  "rasteriseSvgToRgba",
  "injectTextFallbackCss",
  "resizeRaster",
  "resizeRgbaBilinear",
  "computeTargetSize",
  "encodeOutput",
  "assertRaster",
  "encodeGifSingleFrame",
  "stampSvgSize",
  "upsertAttr",
  "rasterToEmbeddedSvg",
  "flattenAlphaOverWhite",
  "dropAlpha",
  "blitRgba",
  "toExactArrayBuffer",
  "copyViewToUint8Array",
  "cacheKeyFromRemoteRequest",
  "ensureCacheDir",
  "readCacheIndex",
  "writeCacheIndex",
  "purgeExpiredCacheEntries",
  "tryLoadFromCache",
  "extensionForContentType",
  "saveToCache",
  "headersToJsonObject",
  "sourceDetails",
  "resizeSpecDetails",
  "firstBytesHex"
] as const;

describe("ImageTransformer delegated façade compatibility", () => {
  test("keeps every original method callable on the same instance through the prototype chain", () => {
    const image = new ImageTransformer();
    for (const name of originalPrivateMethods) {
      expect(typeof (image as unknown as Record<string, unknown>)[name]).toBe("function");
    }
    expect(Object.getOwnPropertyDescriptor(ImageTransformer.prototype, "transformBytes")?.value).toBeFunction();
    expect(Object.getOwnPropertyDescriptor(ImageTransformer.prototype, "transformRemoteUrl")?.value).toBeFunction();
  });

  test("retains default budgets and encode quality in instance options", () => {
    const instance = new ImageTransformer() as unknown as {
      limits: { maxPixels: number; maxSrcBytes: number };
      encodeOptions: { jpegQuality: number };
    };
    expect(instance.limits).toEqual({ maxPixels: 20_000_000, maxSrcBytes: 25 * 1024 * 1024 });
    expect(instance.encodeOptions).toEqual({ jpegQuality: 85 });
    const customised = new ImageTransformer({ maxPixels: 2, maxSrcBytes: 4, jpegQuality: 22 }) as unknown as typeof instance;
    expect(customised.limits).toEqual({ maxPixels: 2, maxSrcBytes: 4 });
    expect(customised.encodeOptions).toEqual({ jpegQuality: 22 });
  });

  test("preserves dispatch through per-instance methods when transforming bytes", async () => {
    const image = new ImageTransformer() as ImageTransformer & { assertByteBudget: (length: number, details: unknown) => void };
    const original = image.assertByteBudget;
    const called: number[] = [];
    image.assertByteBudget = (length, details) => {
      called.push(length);
      original.call(image, length, details);
    };
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>');
    const result = await image.transformBytes({ bytes: svg, format: "svg" });
    expect(result.outputFormat).toBe("svg");
    expect(called).toEqual([svg.byteLength]);
  });

  test("retains pixel-limit errors from the inherited SVG hook chain", async () => {
    const image = new ImageTransformer({ maxPixels: 1 });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>');
    await expect(image.transformBytes({ bytes: svg, format: "png" })).rejects.toMatchObject({
      code: "IMAGE_TOO_LARGE", stage: "decode", httpStatus: 400
    });
  });
});
