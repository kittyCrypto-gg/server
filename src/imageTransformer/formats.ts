import type { TransformerContext } from "./context";
import type { SupportedFormat, DecodedImage } from "./types";
import { ImageTransformError } from "./errors";
import * as jpeg from "jpeg-js";
import { join, posix as pathPosix } from "node:path";

export function getDecodedSize(ctx: TransformerContext, image: DecodedImage): { width: number; height: number } {
    if (image.kind === "svg") {
      const intrinsic = ctx.getSvgIntrinsicSize(image.svgText);
      return ctx.getSvgBaseSize(intrinsic);
    }

    return { width: image.width, height: image.height };
}

export function assertSupportedFormat(ctx: TransformerContext, format: string, side: "input" | "output"): void {
    if (ctx.isSupportedFormat(format)) return;

    throw new ImageTransformError({
      code: "UNSUPPORTED_FORMAT",
      httpStatus: 400,
      message: `Unsupported ${side} format: ${format}`,
      stage: side === "input" ? "decode" : "encode",
      details: {
        side,
        format,
        supportedFormats: ["svg", "png", "gif", "bmp", "jpg", "jpeg", "tif", "tiff", "webp"],
      },
    });
}

export function normaliseFormat(ctx: TransformerContext, value: string | null): SupportedFormat | null {
    if (!value) return null;
    const v = value.trim().toLowerCase();

    switch (v) {
      case "jpeg":
        return "jpeg";
      case "jpg":
        return "jpg";
      case "png":
        return "png";
      case "gif":
        return "gif";
      case "bmp":
        return "bmp";
      case "svg":
        return "svg";
      case "tif":
        return "tif";
      case "tiff":
        return "tiff";
      case "webp":
        return "webp";
      default:
        return null;
    }
}

export function isSupportedFormat(ctx: TransformerContext, f: string): f is SupportedFormat {
    return ctx.normaliseFormat(f) !== null;
}

export function detectFormatFromHeaders(ctx: TransformerContext, headers: Headers): SupportedFormat | null {
    const ct = headers.get("content-type");
    return ct ? ctx.detectFormatFromContentType(ct) : null;
}

export function detectFormatFromContentType(ctx: TransformerContext, contentType: string): SupportedFormat | null {
    const ct = contentType.split(";")[0]?.trim().toLowerCase();
    if (!ct) return null;

    const map: Record<string, SupportedFormat> = {
      "image/png": "png",
      "image/jpeg": "jpeg",
      "image/jpg": "jpg",
      "image/gif": "gif",
      "image/bmp": "bmp",
      "image/svg+xml": "svg",
      "image/tiff": "tiff",
      "image/webp": "webp",
    };

    return map[ct] ?? null;
}

export function detectFormatFromUrl(ctx: TransformerContext, u: URL): SupportedFormat | null {
    const ext = pathPosix.extname(u.pathname).toLowerCase();
    if (!ext) return null;
    return ctx.normaliseFormat(ext.slice(1));
}

export function detectFormatFromMagicBytes(ctx: TransformerContext, bytes: Uint8Array): SupportedFormat | null {
    {
      const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
      const isWebp =
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
      if (bytes.length >= 12 && isRiff && isWebp) return "webp";
    }

    {
      const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      const isPng = pngSig.every((b, i) => bytes[i] === b);
      if (bytes.length >= 8 && isPng) return "png";
    }

    {
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (bytes.length >= 3 && isJpeg) return "jpeg";
    }

    {
      const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
      if (bytes.length >= 6 && (header === "GIF87a" || header === "GIF89a")) return "gif";
    }

    {
      const isBmp = bytes[0] === 0x42 && bytes[1] === 0x4d;
      if (bytes.length >= 2 && isBmp) return "bmp";
    }

    {
      const isLe = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
      const isBe = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
      if (bytes.length >= 4 && (isLe || isBe)) return "tiff";
    }

    const head = bytes.slice(0, 128);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(head).trimStart();
    const looksLikeSvg = text.startsWith("<svg") || text.startsWith("<?xml") || text.startsWith("<!DOCTYPE svg");
    if (looksLikeSvg) return "svg";

    return null;
}
