import type { TransformerContext } from "./context";
import type { SupportedFormat, RasterImage, DecodedImage } from "./types";
import { ImageTransformError } from "./errors";
import { decode as decodePng, encode as encodePng } from "@cf-wasm/png";
import * as jpeg from "jpeg-js";
import * as BMP from "bmp-js";
// @ts-ignore missing upstream typings
import { GIFEncoder, quantize, applyPalette } from "gifenc";
// @ts-ignore missing upstream typings
import * as UTIF from "utif";

export async function encodeOutput(
    ctx: TransformerContext,
    image: DecodedImage,
    format: SupportedFormat,
  ): Promise<{ body: Uint8Array; contentType: string }> {
    try {
      switch (format) {
        case "svg": {
          if (image.kind !== "svg") throw new Error("Internal: expected svg output");
          const body = new TextEncoder().encode(image.svgText);
          return { body, contentType: "image/svg+xml" };
        }
        case "png": {
          ctx.assertRaster(image);
          const body = encodePng(image.rgba, image.width, image.height);
          return { body, contentType: "image/png" };
        }
        case "jpg":
        case "jpeg": {
          ctx.assertRaster(image);
          const flattened = ctx.flattenAlphaOverWhite(image.rgba);
          const encoded = jpeg.encode(
            {
              data: Buffer.from(flattened),
              width: image.width,
              height: image.height,
            },
            ctx.encodeOptions.jpegQuality,
          );

          return { body: new Uint8Array(encoded.data), contentType: "image/jpeg" };
        }
        case "bmp": {
          ctx.assertRaster(image);
          const rgb = ctx.dropAlpha(image.rgba);
          const encoded = BMP.encode({
            data: Buffer.from(rgb),
            width: image.width,
            height: image.height,
          });
          return { body: new Uint8Array(encoded.data), contentType: "image/bmp" };
        }
        case "tif":
        case "tiff": {
          ctx.assertRaster(image);
          const rgba = ctx.copyViewToUint8Array(image.rgba);
          const ifd = UTIF.encodeImage(rgba, image.width, image.height);
          const tiff = UTIF.encode([ifd]) as ArrayBuffer;
          return { body: new Uint8Array(tiff), contentType: "image/tiff" };
        }
        case "gif": {
          ctx.assertRaster(image);
          const body = ctx.encodeGifSingleFrame(image);
          return { body, contentType: "image/gif" };
        }
        case "webp":
          throw new Error("Internal: webp should be passed through without encoding");
      }
    } catch (error: unknown) {
      if (error instanceof ImageTransformError) throw error;

      const message = error instanceof Error ? error.message : `Encode failed with non-Error value: ${String(error)}`;

      throw new ImageTransformError({
        code: "ENCODE_FAILED",
        httpStatus: 500,
        message: `Encode failed while encoding ${format}: ${message}`,
        stage: "encode",
        details: {
          format,
          sourceKind: image.kind,
          sourceWidth: image.kind === "raster" ? image.width : 0,
          sourceHeight: image.kind === "raster" ? image.height : 0,
        },
        cause: error,
      });
    }
}

export function assertRaster(ctx: TransformerContext, image: DecodedImage): asserts image is RasterImage {
    if (image.kind === "raster") return;
    throw new Error("Internal: expected raster output");
}

export function encodeGifSingleFrame(ctx: TransformerContext, img: RasterImage): Uint8Array {
    const rgba = ctx.copyViewToUint8Array(img.rgba);

    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3];
      if (a <= 127) {
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
      } else {
        rgba[i + 3] = 255;
      }
    }

    const paletteBody = quantize(rgba, 255, {
      format: "rgba4444",
      oneBitAlpha: true,
      clearAlpha: true,
      clearAlphaColor: 0x00,
    });

    const palette = [[0, 0, 0, 0], ...paletteBody];
    const index = applyPalette(rgba, palette, "rgba4444");
    const gif = GIFEncoder();

    gif.writeFrame(index, img.width, img.height, {
      palette,
      transparent: true,
      transparentIndex: 0,
    });

    gif.finish();
    return gif.bytes();
}

export function flattenAlphaOverWhite(ctx: TransformerContext, rgba: Uint8Array): Uint8Array {
    const out = new Uint8Array(rgba.length);

    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3] / 255;

      out[i] = Math.round(r * a + 255 * (1 - a));
      out[i + 1] = Math.round(g * a + 255 * (1 - a));
      out[i + 2] = Math.round(b * a + 255 * (1 - a));
      out[i + 3] = 255;
    }

    return out;
}

export function dropAlpha(ctx: TransformerContext, rgba: Uint8Array): Uint8Array {
    const out = new Uint8Array((rgba.length / 4) * 3);
    let j = 0;

    for (let i = 0; i < rgba.length; i += 4) {
      out[j++] = rgba[i];
      out[j++] = rgba[i + 1];
      out[j++] = rgba[i + 2];
    }

    return out;
}

export function toExactArrayBuffer(ctx: TransformerContext, bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function copyViewToUint8Array(ctx: TransformerContext, view: ArrayBufferView): Uint8Array {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}
