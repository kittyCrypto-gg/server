import type { TransformerContext } from "./context";
import type { SupportedFormat, ResizeSpec, RasterImage, SvgImage, DecodedImage, TransformResult, ImageTransformErrorDetails, CacheIndex, SvgIntrinsicSize } from "./types";
import { ImageTransformerSourceMethods } from "./facadeSource";
import { decodeImage as decodeImage_operation, expandToRgba as expandToRgba_operation, decodePngToRgba as decodePngToRgba_operation, decodeJpegToRgba as decodeJpegToRgba_operation, decodeBmpToRgba as decodeBmpToRgba_operation, decodeTiffToRgba as decodeTiffToRgba_operation, decodeGifToRgba as decodeGifToRgba_operation } from "./decoders";
import { resizeSvgDocument as resizeSvgDocument_operation, decodeSvgToRgba as decodeSvgToRgba_operation, getSvgIntrinsicSize as getSvgIntrinsicSize_operation, getSvgBaseSize as getSvgBaseSize_operation, getAttr as getAttr_operation, parseViewBox as parseViewBox_operation, parseSvgLength as parseSvgLength_operation, ensureSvgViewBox as ensureSvgViewBox_operation, rasteriseSvgToRgba as rasteriseSvgToRgba_operation, injectTextFallbackCss as injectTextFallbackCss_operation, stampSvgSize as stampSvgSize_operation, upsertAttr as upsertAttr_operation, rasterToEmbeddedSvg as rasterToEmbeddedSvg_operation } from "./svg";

/** Internal ImageTransformer delegation methods: decoding. */
export class ImageTransformerDecodingMethods extends ImageTransformerSourceMethods {
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

  private stampSvgSize(svgText: string, spec: ResizeSpec): string {
    return stampSvgSize_operation(this as unknown as TransformerContext, svgText, spec);
  }

  private upsertAttr(attrs: string, name: string, value: string | null): string {
    return upsertAttr_operation(this as unknown as TransformerContext, attrs, name, value);
  }

  private rasterToEmbeddedSvg(img: RasterImage): SvgImage {
    return rasterToEmbeddedSvg_operation(this as unknown as TransformerContext, img);
  }
}
