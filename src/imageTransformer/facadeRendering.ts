import type { TransformerContext } from "./context";
import type { SupportedFormat, ResizeSpec, RasterImage, SvgImage, DecodedImage, TransformResult, ImageTransformErrorDetails, CacheIndex, SvgIntrinsicSize } from "./types";
import { ImageTransformerDecodingMethods } from "./facadeDecoding";
import { transform as transform_operation, resizeRaster as resizeRaster_operation, resizeRgbaBilinear as resizeRgbaBilinear_operation, computeTargetSize as computeTargetSize_operation, blitRgba as blitRgba_operation } from "./resize";
import { encodeOutput as encodeOutput_operation, assertRaster as assertRaster_operation, encodeGifSingleFrame as encodeGifSingleFrame_operation, flattenAlphaOverWhite as flattenAlphaOverWhite_operation, dropAlpha as dropAlpha_operation, toExactArrayBuffer as toExactArrayBuffer_operation, copyViewToUint8Array as copyViewToUint8Array_operation } from "./encoders";

/** Internal ImageTransformer delegation methods: rendering. */
export class ImageTransformerRenderingMethods extends ImageTransformerDecodingMethods {
  private async transform(decoded: DecodedImage, resizeSpec: ResizeSpec, outputFormat: SupportedFormat): Promise<DecodedImage> {
    return transform_operation(this as unknown as TransformerContext, decoded, resizeSpec, outputFormat);
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
}
