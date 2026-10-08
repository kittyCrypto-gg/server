import type { TransformerContext } from "./context";
import type { SupportedFormat, ResizeSpec, RasterImage, DecodedImage } from "./types";
import { ImageTransformError } from "./errors";

export async function transform(ctx: TransformerContext, decoded: DecodedImage, resizeSpec: ResizeSpec, outputFormat: SupportedFormat): Promise<DecodedImage> {
    try {
      const wantsSvg = outputFormat === "svg";

      if (wantsSvg && decoded.kind === "raster") {
        const resizedRaster = ctx.resizeRaster(decoded, resizeSpec);
        return ctx.rasterToEmbeddedSvg(resizedRaster);
      }

      if (decoded.kind === "svg" && wantsSvg) {
        return { kind: "svg", svgText: ctx.resizeSvgDocument(decoded.svgText, resizeSpec) };
      }

      if (decoded.kind === "svg") {
        const rasterised = await ctx.decodeSvgToRgba(decoded.svgText);
        return ctx.resizeRaster(rasterised, resizeSpec);
      }

      return ctx.resizeRaster(decoded, resizeSpec);
    } catch (error) {
      if (error instanceof ImageTransformError) throw error;

      throw new ImageTransformError({
        code: "TRANSFORM_FAILED",
        httpStatus: 500,
        message: "Image transform failed",
        stage: "transform",
        details: {
          outputFormat,
          resize: ctx.resizeSpecDetails(resizeSpec),
          sourceKind: decoded.kind,
          sourceWidth: decoded.kind === "raster" ? decoded.width : 0,
          sourceHeight: decoded.kind === "raster" ? decoded.height : 0,
        },
        cause: error,
      });
    }
}

export function resizeRaster(ctx: TransformerContext, image: RasterImage, resizeSpec: ResizeSpec): RasterImage {
    const target = ctx.computeTargetSize(image.width, image.height, resizeSpec);
    const isAlreadyRight = target.width === image.width && target.height === image.height;
    if (isAlreadyRight) return image;

    ctx.assertPixelBudget(target.width, target.height);

    return {
      kind: "raster",
      width: target.width,
      height: target.height,
      rgba: ctx.resizeRgbaBilinear(image.rgba, image.width, image.height, target.width, target.height),
    };
}

export function resizeRgbaBilinear(
    ctx: TransformerContext,
    source: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
  ): Uint8Array {
    const target = new Uint8Array(targetWidth * targetHeight * 4);

    const xRatio = targetWidth > 1
      ? (sourceWidth - 1) / (targetWidth - 1)
      : 0;

    const yRatio = targetHeight > 1
      ? (sourceHeight - 1) / (targetHeight - 1)
      : 0;

    for (let y = 0; y < targetHeight; y++) {
      const sourceY = y * yRatio;
      const y0 = Math.floor(sourceY);
      const y1 = Math.min(y0 + 1, sourceHeight - 1);
      const yWeight = sourceY - y0;

      for (let x = 0; x < targetWidth; x++) {
        const sourceX = x * xRatio;
        const x0 = Math.floor(sourceX);
        const x1 = Math.min(x0 + 1, sourceWidth - 1);
        const xWeight = sourceX - x0;

        const targetIndex = (y * targetWidth + x) * 4;
        const topLeftIndex = (y0 * sourceWidth + x0) * 4;
        const topRightIndex = (y0 * sourceWidth + x1) * 4;
        const bottomLeftIndex = (y1 * sourceWidth + x0) * 4;
        const bottomRightIndex = (y1 * sourceWidth + x1) * 4;

        for (let channel = 0; channel < 4; channel++) {
          const topLeft = source[topLeftIndex + channel];
          const topRight = source[topRightIndex + channel];
          const bottomLeft = source[bottomLeftIndex + channel];
          const bottomRight = source[bottomRightIndex + channel];

          const top = topLeft + (topRight - topLeft) * xWeight;
          const bottom = bottomLeft + (bottomRight - bottomLeft) * xWeight;
          target[targetIndex + channel] = Math.round(top + (bottom - top) * yWeight);
        }
      }
    }

    return target;
}

export function computeTargetSize(ctx: TransformerContext, srcW: number, srcH: number, spec: ResizeSpec): { width: number; height: number } {
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

export function blitRgba(
    ctx: TransformerContext,
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
