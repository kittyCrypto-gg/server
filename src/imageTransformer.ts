import type { TransformerLimits, TransformerEncodeOptions } from "./imageTransformer/types";
import type { TransformerContext } from "./imageTransformer/context";
import { transformRemoteUrl as transformRemoteUrl_operation, transformBytes as transformBytes_operation } from "./imageTransformer/pipeline";
import { resolveSrcUrlWithDetail as resolveSrcUrlWithDetail_operation, parseOptionalUrlHint as parseOptionalUrlHint_operation, fetchRemoteSource as fetchRemoteSource_operation, readResponseBytes as readResponseBytes_operation, resolveSrcUrl as resolveSrcUrl_operation, assertByteBudget as assertByteBudget_operation, assertPixelBudget as assertPixelBudget_operation } from "./imageTransformer/remoteSource";
import { passThroughWebp as passThroughWebp_operation, passThroughGif as passThroughGif_operation } from "./imageTransformer/passThrough";
import { getDecodedSize as getDecodedSize_operation, assertSupportedFormat as assertSupportedFormat_operation, normaliseFormat as normaliseFormat_operation, isSupportedFormat as isSupportedFormat_operation, detectFormatFromHeaders as detectFormatFromHeaders_operation, detectFormatFromContentType as detectFormatFromContentType_operation, detectFormatFromUrl as detectFormatFromUrl_operation, detectFormatFromMagicBytes as detectFormatFromMagicBytes_operation } from "./imageTransformer/formats";
import { decodeImage as decodeImage_operation, expandToRgba as expandToRgba_operation, decodePngToRgba as decodePngToRgba_operation, decodeJpegToRgba as decodeJpegToRgba_operation, decodeBmpToRgba as decodeBmpToRgba_operation, decodeTiffToRgba as decodeTiffToRgba_operation, decodeGifToRgba as decodeGifToRgba_operation } from "./imageTransformer/decoders";
import { resizeSvgDocument as resizeSvgDocument_operation, decodeSvgToRgba as decodeSvgToRgba_operation, getSvgIntrinsicSize as getSvgIntrinsicSize_operation, getSvgBaseSize as getSvgBaseSize_operation, getAttr as getAttr_operation, parseViewBox as parseViewBox_operation, parseSvgLength as parseSvgLength_operation, ensureSvgViewBox as ensureSvgViewBox_operation, rasteriseSvgToRgba as rasteriseSvgToRgba_operation, injectTextFallbackCss as injectTextFallbackCss_operation, stampSvgSize as stampSvgSize_operation, upsertAttr as upsertAttr_operation, rasterToEmbeddedSvg as rasterToEmbeddedSvg_operation } from "./imageTransformer/svg";
import { transform as transform_operation, resizeRaster as resizeRaster_operation, resizeRgbaBilinear as resizeRgbaBilinear_operation, computeTargetSize as computeTargetSize_operation, blitRgba as blitRgba_operation } from "./imageTransformer/resize";
import { encodeOutput as encodeOutput_operation, assertRaster as assertRaster_operation, encodeGifSingleFrame as encodeGifSingleFrame_operation, flattenAlphaOverWhite as flattenAlphaOverWhite_operation, dropAlpha as dropAlpha_operation, toExactArrayBuffer as toExactArrayBuffer_operation, copyViewToUint8Array as copyViewToUint8Array_operation } from "./imageTransformer/encoders";
import { cacheKeyFromRemoteRequest as cacheKeyFromRemoteRequest_operation, ensureCacheDir as ensureCacheDir_operation, readCacheIndex as readCacheIndex_operation, writeCacheIndex as writeCacheIndex_operation, purgeExpiredCacheEntries as purgeExpiredCacheEntries_operation, tryLoadFromCache as tryLoadFromCache_operation, extensionForContentType as extensionForContentType_operation, saveToCache as saveToCache_operation } from "./imageTransformer/cache";
import { headersToJsonObject as headersToJsonObject_operation, sourceDetails as sourceDetails_operation, resizeSpecDetails as resizeSpecDetails_operation, firstBytesHex as firstBytesHex_operation } from "./imageTransformer/diagnostics";
import type { SupportedFormat, ResizeSpec, RasterImage, SvgImage, DecodedImage, TransformRemoteUrlInput, TransformBytesInput, TransformResult, TransformerLimits, TransformerEncodeOptions, ImageTransformerOptions, TransformErrorCode, TransformErrorStage, ImageTransformErrorDetails, UnknownErrorSummary, ImageTransformErrorBody, ResvgRenderOptions, ResvgInstance, ResvgStatic, CacheIndexEntry, CacheIndex, SvgIntrinsicSize } from "./imageTransformer/types";

export type {
  SupportedFormat,
  ResizeSpec,
  TransformRemoteUrlInput,
  TransformBytesInput,
  TransformResult,
  ImageTransformerOptions,
  TransformErrorCode,
  TransformErrorStage,
  ImageTransformErrorDetails,
  ImageTransformErrorBody,
} from "./imageTransformer/types";
export { ImageTransformError, toImageTransformErrorBody, createImageTransformErrorBody } from "./imageTransformer/errors";

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
    return transformRemoteUrl_operation(this as unknown as TransformerContext, input);
  }

  public async transformBytes(input: TransformBytesInput): Promise<TransformResult> {
    return transformBytes_operation(this as unknown as TransformerContext, input);
  }

  private resolveSrcUrlWithDetail(src: string, baseUrl?: string): URL {
    return resolveSrcUrlWithDetail_operation(this as unknown as TransformerContext, src, baseUrl);
  }

  private parseOptionalUrlHint(originalUrlHint?: string): URL | null {
    return parseOptionalUrlHint_operation(this as unknown as TransformerContext, originalUrlHint);
  }

  private async fetchRemoteSource(srcUrl: URL, requestHeaders?: Record<string, string>): Promise<Response> {
    return fetchRemoteSource_operation(this as unknown as TransformerContext, srcUrl, requestHeaders);
  }

  private async readResponseBytes(response: Response, srcUrl: URL): Promise<Uint8Array> {
    return readResponseBytes_operation(this as unknown as TransformerContext, response, srcUrl);
  }

  private passThroughWebp(
    input: { format?: SupportedFormat; resize?: ResizeSpec },
    bytes: Uint8Array,
    detectedSrcFormat: SupportedFormat,
  ): TransformResult {
    return passThroughWebp_operation(this as unknown as TransformerContext, input, bytes, detectedSrcFormat);
  }

  private passThroughGif(
    input: { format?: SupportedFormat; resize?: ResizeSpec },
    bytes: Uint8Array,
    detectedSrcFormat: SupportedFormat,
  ): TransformResult {
    return passThroughGif_operation(this as unknown as TransformerContext, input, bytes, detectedSrcFormat);
  }

  private getDecodedSize(image: DecodedImage): { width: number; height: number } {
    return getDecodedSize_operation(this as unknown as TransformerContext, image);
  }

  private resolveSrcUrl(src: string, baseUrl?: string): URL {
    return resolveSrcUrl_operation(this as unknown as TransformerContext, src, baseUrl);
  }

  private assertByteBudget(byteLength: number, details: ImageTransformErrorDetails): void {
    return assertByteBudget_operation(this as unknown as TransformerContext, byteLength, details);
  }

  private assertPixelBudget(w: number, h: number): void {
    return assertPixelBudget_operation(this as unknown as TransformerContext, w, h);
  }

  private assertSupportedFormat(format: string, side: "input" | "output"): void {
    return assertSupportedFormat_operation(this as unknown as TransformerContext, format, side);
  }

  private normaliseFormat(value: string | null): SupportedFormat | null {
    return normaliseFormat_operation(this as unknown as TransformerContext, value);
  }

  private isSupportedFormat(f: string): f is SupportedFormat {
    return isSupportedFormat_operation(this as unknown as TransformerContext, f);
  }

  private detectFormatFromHeaders(headers: Headers): SupportedFormat | null {
    return detectFormatFromHeaders_operation(this as unknown as TransformerContext, headers);
  }

  private detectFormatFromContentType(contentType: string): SupportedFormat | null {
    return detectFormatFromContentType_operation(this as unknown as TransformerContext, contentType);
  }

  private detectFormatFromUrl(u: URL): SupportedFormat | null {
    return detectFormatFromUrl_operation(this as unknown as TransformerContext, u);
  }

  private detectFormatFromMagicBytes(bytes: Uint8Array): SupportedFormat | null {
    return detectFormatFromMagicBytes_operation(this as unknown as TransformerContext, bytes);
  }

  private async decodeImage(format: SupportedFormat, bytes: Uint8Array): Promise<DecodedImage> {
    return decodeImage_operation(this as unknown as TransformerContext, format, bytes);
  }

  private expandToRgba(raw: Uint8Array, width: number, height: number, format: SupportedFormat): Uint8Array {
    return expandToRgba_operation(this as unknown as TransformerContext, raw, width, height, format);
  }

  private async decodePngToRgba(bytes: Uint8Array): Promise<RasterImage> {
    return decodePngToRgba_operation(this as unknown as TransformerContext, bytes);
  }

  private async decodeJpegToRgba(bytes: Uint8Array): Promise<RasterImage> {
    return decodeJpegToRgba_operation(this as unknown as TransformerContext, bytes);
  }

  private async decodeBmpToRgba(bytes: Uint8Array): Promise<RasterImage> {
    return decodeBmpToRgba_operation(this as unknown as TransformerContext, bytes);
  }

  private async decodeTiffToRgba(bytes: Uint8Array): Promise<RasterImage> {
    return decodeTiffToRgba_operation(this as unknown as TransformerContext, bytes);
  }

  private async decodeGifToRgba(bytes: Uint8Array): Promise<RasterImage> {
    return decodeGifToRgba_operation(this as unknown as TransformerContext, bytes);
  }

  private async transform(decoded: DecodedImage, resizeSpec: ResizeSpec, outputFormat: SupportedFormat): Promise<DecodedImage> {
    return transform_operation(this as unknown as TransformerContext, decoded, resizeSpec, outputFormat);
  }

  private resizeSvgDocument(svgText: string, resizeSpec: ResizeSpec): string {
    return resizeSvgDocument_operation(this as unknown as TransformerContext, svgText, resizeSpec);
  }

  private async decodeSvgToRgba(svgText: string): Promise<RasterImage> {
    return decodeSvgToRgba_operation(this as unknown as TransformerContext, svgText);
  }

  private getSvgIntrinsicSize(svgText: string): SvgIntrinsicSize {
    return getSvgIntrinsicSize_operation(this as unknown as TransformerContext, svgText);
  }

  private getSvgBaseSize(intrinsic: SvgIntrinsicSize): { width: number; height: number } {
    return getSvgBaseSize_operation(this as unknown as TransformerContext, intrinsic);
  }

  private getAttr(svgText: string, name: string): string | null {
    return getAttr_operation(this as unknown as TransformerContext, svgText, name);
  }

  private parseViewBox(viewBox: string): { w: number; h: number } | null {
    return parseViewBox_operation(this as unknown as TransformerContext, viewBox);
  }

  private parseSvgLength(v: string | null): number | null {
    return parseSvgLength_operation(this as unknown as TransformerContext, v);
  }

  private ensureSvgViewBox(svgText: string, viewBox: string): string {
    return ensureSvgViewBox_operation(this as unknown as TransformerContext, svgText, viewBox);
  }

  private async rasteriseSvgToRgba(
    svgText: string,
    width: number,
    height: number,
  ): Promise<RasterImage> {
    return rasteriseSvgToRgba_operation(this as unknown as TransformerContext, svgText, width, height);
  }

  private injectTextFallbackCss(svgText: string, family: string): string {
    return injectTextFallbackCss_operation(this as unknown as TransformerContext, svgText, family);
  }

  private resizeRaster(image: RasterImage, resizeSpec: ResizeSpec): RasterImage {
    return resizeRaster_operation(this as unknown as TransformerContext, image, resizeSpec);
  }

  private resizeRgbaBilinear(
    source: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
  ): Uint8Array {
    return resizeRgbaBilinear_operation(this as unknown as TransformerContext, source, sourceWidth, sourceHeight, targetWidth, targetHeight);
  }

  private computeTargetSize(srcW: number, srcH: number, spec: ResizeSpec): { width: number; height: number } {
    return computeTargetSize_operation(this as unknown as TransformerContext, srcW, srcH, spec);
  }

  private async encodeOutput(
    image: DecodedImage,
    format: SupportedFormat,
  ): Promise<{ body: Uint8Array; contentType: string }> {
    return encodeOutput_operation(this as unknown as TransformerContext, image, format);
  }

  private assertRaster(image: DecodedImage): asserts image is RasterImage {
    return assertRaster_operation(this as unknown as TransformerContext, image);
  }

  private encodeGifSingleFrame(img: RasterImage): Uint8Array {
    return encodeGifSingleFrame_operation(this as unknown as TransformerContext, img);
  }

  private stampSvgSize(svgText: string, spec: ResizeSpec): string {
    return stampSvgSize_operation(this as unknown as TransformerContext, svgText, spec);
  }

  private upsertAttr(attrs: string, name: string, value: string | null): string {
    return upsertAttr_operation(this as unknown as TransformerContext, attrs, name, value);
  }

  private rasterToEmbeddedSvg(img: RasterImage): SvgImage {
    return rasterToEmbeddedSvg_operation(this as unknown as TransformerContext, img);
  }

  private flattenAlphaOverWhite(rgba: Uint8Array): Uint8Array {
    return flattenAlphaOverWhite_operation(this as unknown as TransformerContext, rgba);
  }

  private dropAlpha(rgba: Uint8Array): Uint8Array {
    return dropAlpha_operation(this as unknown as TransformerContext, rgba);
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
    return blitRgba_operation(this as unknown as TransformerContext, dst, dstW, dstH, src, srcW, srcH, left, top);
  }

  private toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return toExactArrayBuffer_operation(this as unknown as TransformerContext, bytes);
  }

  private copyViewToUint8Array(view: ArrayBufferView): Uint8Array {
    return copyViewToUint8Array_operation(this as unknown as TransformerContext, view);
  }

  private cacheKeyFromRemoteRequest(args: {
    srcUrl: string;
    outputFormat: SupportedFormat;
    resize: ResizeSpec;
    detectedSrcFormatHint: SupportedFormat;
  }): string {
    return cacheKeyFromRemoteRequest_operation(this as unknown as TransformerContext, args);
  }

  private async ensureCacheDir(): Promise<void> {
    return ensureCacheDir_operation(this as unknown as TransformerContext);
  }

  private async readCacheIndex(): Promise<CacheIndex> {
    return readCacheIndex_operation(this as unknown as TransformerContext);
  }

  private async writeCacheIndex(index: CacheIndex): Promise<void> {
    return writeCacheIndex_operation(this as unknown as TransformerContext, index);
  }

  private async purgeExpiredCacheEntries(index: CacheIndex): Promise<boolean> {
    return purgeExpiredCacheEntries_operation(this as unknown as TransformerContext, index);
  }

  private async tryLoadFromCache(args: {
    kind: "remote";
    srcUrl: string;
    outputFormat: SupportedFormat;
    resize: ResizeSpec;
    detectedSrcFormatHint: SupportedFormat;
  }): Promise<TransformResult | null> {
    return tryLoadFromCache_operation(this as unknown as TransformerContext, args);
  }

  private extensionForContentType(contentType: string): string {
    return extensionForContentType_operation(this as unknown as TransformerContext, contentType);
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
    return saveToCache_operation(this as unknown as TransformerContext, args, result);
  }

  private headersToJsonObject(headers: Headers): ImageTransformErrorDetails {
    return headersToJsonObject_operation(this as unknown as TransformerContext, headers);
  }

  private sourceDetails(srcUrl: URL): ImageTransformErrorDetails {
    return sourceDetails_operation(this as unknown as TransformerContext, srcUrl);
  }

  private resizeSpecDetails(spec: ResizeSpec): ImageTransformErrorDetails {
    return resizeSpecDetails_operation(this as unknown as TransformerContext, spec);
  }

  private firstBytesHex(bytes: Uint8Array): string {
    return firstBytesHex_operation(this as unknown as TransformerContext, bytes);
  }
}
