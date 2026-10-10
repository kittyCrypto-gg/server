import type { TransformerContext } from "./context";
import type { SupportedFormat, ResizeSpec, RasterImage, SvgImage, DecodedImage, TransformResult, ImageTransformErrorDetails, CacheIndex, SvgIntrinsicSize } from "./types";
import { resolveSrcUrlWithDetail as resolveSrcUrlWithDetail_operation, parseOptionalUrlHint as parseOptionalUrlHint_operation, fetchRemoteSource as fetchRemoteSource_operation, readResponseBytes as readResponseBytes_operation, resolveSrcUrl as resolveSrcUrl_operation, assertByteBudget as assertByteBudget_operation, assertPixelBudget as assertPixelBudget_operation } from "./remoteSource";
import { passThroughWebp as passThroughWebp_operation, passThroughGif as passThroughGif_operation } from "./passThrough";
import { getDecodedSize as getDecodedSize_operation, assertSupportedFormat as assertSupportedFormat_operation, normaliseFormat as normaliseFormat_operation, isSupportedFormat as isSupportedFormat_operation, detectFormatFromHeaders as detectFormatFromHeaders_operation, detectFormatFromContentType as detectFormatFromContentType_operation, detectFormatFromUrl as detectFormatFromUrl_operation, detectFormatFromMagicBytes as detectFormatFromMagicBytes_operation } from "./formats";
import { headersToJsonObject as headersToJsonObject_operation, sourceDetails as sourceDetails_operation, resizeSpecDetails as resizeSpecDetails_operation, firstBytesHex as firstBytesHex_operation } from "./diagnostics";

/** Internal ImageTransformer delegation methods: source. */
export class ImageTransformerSourceMethods {
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
