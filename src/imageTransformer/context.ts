import type { SupportedFormat, ResizeSpec, RasterImage, SvgImage, DecodedImage, TransformRemoteUrlInput, TransformBytesInput, TransformResult, TransformerLimits, TransformerEncodeOptions, ImageTransformErrorDetails, CacheIndex, SvgIntrinsicSize } from "./types";

/** Internal typed view of the existing ImageTransformer instance. */
export interface TransformerContext {
  limits: TransformerLimits;
  encodeOptions: TransformerEncodeOptions;
  transformRemoteUrl(input: TransformRemoteUrlInput): Promise<TransformResult>;
  transformBytes(input: TransformBytesInput): Promise<TransformResult>;
  resolveSrcUrlWithDetail(src: string, baseUrl?: string): URL;
  parseOptionalUrlHint(originalUrlHint?: string): URL | null;
  fetchRemoteSource(srcUrl: URL, requestHeaders?: Record<string, string>): Promise<Response>;
  readResponseBytes(response: Response, srcUrl: URL): Promise<Uint8Array>;
  resolveSrcUrl(src: string, baseUrl?: string): URL;
  assertByteBudget(byteLength: number, details: ImageTransformErrorDetails): void;
  assertPixelBudget(w: number, h: number): void;
  passThroughWebp(
    input: { format?: SupportedFormat; resize?: ResizeSpec },
    bytes: Uint8Array,
    detectedSrcFormat: SupportedFormat,
  ): TransformResult;
  passThroughGif(
    input: { format?: SupportedFormat; resize?: ResizeSpec },
    bytes: Uint8Array,
    detectedSrcFormat: SupportedFormat,
  ): TransformResult;
  getDecodedSize(image: DecodedImage): { width: number; height: number };
  assertSupportedFormat(format: string, side: "input" | "output"): void;
  normaliseFormat(value: string | null): SupportedFormat | null;
  isSupportedFormat(f: string): f is SupportedFormat;
  detectFormatFromHeaders(headers: Headers): SupportedFormat | null;
  detectFormatFromContentType(contentType: string): SupportedFormat | null;
  detectFormatFromUrl(u: URL): SupportedFormat | null;
  detectFormatFromMagicBytes(bytes: Uint8Array): SupportedFormat | null;
  decodeImage(format: SupportedFormat, bytes: Uint8Array): Promise<DecodedImage>;
  expandToRgba(raw: Uint8Array, width: number, height: number, format: SupportedFormat): Uint8Array;
  decodePngToRgba(bytes: Uint8Array): Promise<RasterImage>;
  decodeJpegToRgba(bytes: Uint8Array): Promise<RasterImage>;
  decodeBmpToRgba(bytes: Uint8Array): Promise<RasterImage>;
  decodeTiffToRgba(bytes: Uint8Array): Promise<RasterImage>;
  decodeGifToRgba(bytes: Uint8Array): Promise<RasterImage>;
  resizeSvgDocument(svgText: string, resizeSpec: ResizeSpec): string;
  decodeSvgToRgba(svgText: string): Promise<RasterImage>;
  getSvgIntrinsicSize(svgText: string): SvgIntrinsicSize;
  getSvgBaseSize(intrinsic: SvgIntrinsicSize): { width: number; height: number };
  getAttr(svgText: string, name: string): string | null;
  parseViewBox(viewBox: string): { w: number; h: number } | null;
  parseSvgLength(v: string | null): number | null;
  ensureSvgViewBox(svgText: string, viewBox: string): string;
  rasteriseSvgToRgba(
    svgText: string,
    width: number,
    height: number,
  ): Promise<RasterImage>;
  injectTextFallbackCss(svgText: string, family: string): string;
  stampSvgSize(svgText: string, spec: ResizeSpec): string;
  upsertAttr(attrs: string, name: string, value: string | null): string;
  rasterToEmbeddedSvg(img: RasterImage): SvgImage;
  transform(decoded: DecodedImage, resizeSpec: ResizeSpec, outputFormat: SupportedFormat): Promise<DecodedImage>;
  resizeRaster(image: RasterImage, resizeSpec: ResizeSpec): RasterImage;
  resizeRgbaBilinear(
    source: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
  ): Uint8Array;
  computeTargetSize(srcW: number, srcH: number, spec: ResizeSpec): { width: number; height: number };
  blitRgba(
    dst: Uint8Array,
    dstW: number,
    dstH: number,
    src: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    left: number,
    top: number,
  ): void;
  encodeOutput(
    image: DecodedImage,
    format: SupportedFormat,
  ): Promise<{ body: Uint8Array; contentType: string }>;
  assertRaster(image: DecodedImage): asserts image is RasterImage;
  encodeGifSingleFrame(img: RasterImage): Uint8Array;
  flattenAlphaOverWhite(rgba: Uint8Array): Uint8Array;
  dropAlpha(rgba: Uint8Array): Uint8Array;
  toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer;
  copyViewToUint8Array(view: ArrayBufferView): Uint8Array;
  cacheKeyFromRemoteRequest(args: {
    srcUrl: string;
    outputFormat: SupportedFormat;
    resize: ResizeSpec;
    detectedSrcFormatHint: SupportedFormat;
  }): string;
  ensureCacheDir(): Promise<void>;
  readCacheIndex(): Promise<CacheIndex>;
  writeCacheIndex(index: CacheIndex): Promise<void>;
  purgeExpiredCacheEntries(index: CacheIndex): Promise<boolean>;
  tryLoadFromCache(args: {
    kind: "remote";
    srcUrl: string;
    outputFormat: SupportedFormat;
    resize: ResizeSpec;
    detectedSrcFormatHint: SupportedFormat;
  }): Promise<TransformResult | null>;
  extensionForContentType(contentType: string): string;
  saveToCache(
    args: {
      kind: "remote";
      srcUrl: string;
      outputFormat: SupportedFormat;
      resize: ResizeSpec;
      detectedSrcFormatHint: SupportedFormat;
    },
    result: TransformResult,
  ): Promise<void>;
  headersToJsonObject(headers: Headers): ImageTransformErrorDetails;
  sourceDetails(srcUrl: URL): ImageTransformErrorDetails;
  resizeSpecDetails(spec: ResizeSpec): ImageTransformErrorDetails;
  firstBytesHex(bytes: Uint8Array): string;
}
