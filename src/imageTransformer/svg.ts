import type { TransformerContext } from "./context";
import type { SupportedFormat, ResizeSpec, RasterImage, SvgImage, DecodedImage, TransformRemoteUrlInput, TransformBytesInput, TransformResult, TransformerLimits, TransformerEncodeOptions, ImageTransformerOptions, TransformErrorCode, TransformErrorStage, ImageTransformErrorDetails, UnknownErrorSummary, ImageTransformErrorBody, ResvgRenderOptions, ResvgInstance, ResvgStatic, CacheIndexEntry, CacheIndex, SvgIntrinsicSize } from "./types";
import { Resvg } from "@cf-wasm/resvg/node";
const ResvgTyped = Resvg as unknown as ResvgStatic;
import { decode as decodePng, encode as encodePng } from "@cf-wasm/png";
import { join, posix as pathPosix } from "node:path";
import { readFileSync } from "node:fs";

export function resizeSvgDocument(ctx: TransformerContext, svgText: string, resizeSpec: ResizeSpec): string {
    const wantsResize = Boolean(resizeSpec.width || resizeSpec.height);
    if (!wantsResize) return svgText;

    const intrinsic = ctx.getSvgIntrinsicSize(svgText);
    const base = ctx.getSvgBaseSize(intrinsic);
    const target = ctx.computeTargetSize(base.width, base.height, resizeSpec);

    ctx.assertPixelBudget(target.width, target.height);

    const normalisedSvg = ctx.ensureSvgViewBox(svgText, `0 0 ${base.width} ${base.height}`);

    return ctx.stampSvgSize(normalisedSvg, {
      width: target.width,
      height: target.height,
    });
}

export async function decodeSvgToRgba(ctx: TransformerContext, svgText: string): Promise<RasterImage> {
    const intrinsic = ctx.getSvgIntrinsicSize(svgText);
    const base = ctx.getSvgBaseSize(intrinsic);

    ctx.assertPixelBudget(base.width, base.height);

    const normalisedSvg = ctx.ensureSvgViewBox(svgText, `0 0 ${base.width} ${base.height}`);
    return await ctx.rasteriseSvgToRgba(normalisedSvg, base.width, base.height);
}

export function getSvgIntrinsicSize(ctx: TransformerContext, svgText: string): SvgIntrinsicSize {
    const width = ctx.parseSvgLength(ctx.getAttr(svgText, "width"));
    const height = ctx.parseSvgLength(ctx.getAttr(svgText, "height"));

    const vb = ctx.getAttr(svgText, "viewBox");
    const viewBox = vb ? ctx.parseViewBox(vb) : null;

    return {
      width: width ?? undefined,
      height: height ?? undefined,
      viewBox: viewBox ?? undefined,
    };
}

export function getSvgBaseSize(ctx: TransformerContext, intrinsic: SvgIntrinsicSize): { width: number; height: number } {
    if (intrinsic.width && intrinsic.height) {
      return { width: intrinsic.width, height: intrinsic.height };
    }

    if (intrinsic.width && intrinsic.viewBox?.w && intrinsic.viewBox?.h) {
      const height = Math.max(1, Math.round((intrinsic.viewBox.h * intrinsic.width) / intrinsic.viewBox.w));
      return { width: intrinsic.width, height };
    }

    if (intrinsic.height && intrinsic.viewBox?.w && intrinsic.viewBox?.h) {
      const width = Math.max(1, Math.round((intrinsic.viewBox.w * intrinsic.height) / intrinsic.viewBox.h));
      return { width, height: intrinsic.height };
    }

    if (intrinsic.viewBox?.w && intrinsic.viewBox?.h) {
      return {
        width: Math.max(1, Math.round(intrinsic.viewBox.w)),
        height: Math.max(1, Math.round(intrinsic.viewBox.h)),
      };
    }

    return { width: 512, height: 512 };
}

export function getAttr(ctx: TransformerContext, svgText: string, name: string): string | null {
    const re = new RegExp(`<svg\\b[^>]*\\s${name}\\s*=\\s*["']([^"']+)["']`, "i");
    const m = svgText.match(re);
    return m?.[1] ?? null;
}

export function parseViewBox(ctx: TransformerContext, viewBox: string): { w: number; h: number } | null {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4) return null;

    const w = parts[2];
    const h = parts[3];

    const ok = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
    return ok ? { w, h } : null;
}

export function parseSvgLength(ctx: TransformerContext, v: string | null): number | null {
    if (!v) return null;
    const s = v.trim().toLowerCase();

    const m = s.match(/^([0-9]*\.?[0-9]+)(px)?$/);
    if (!m) return null;

    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
}

export function ensureSvgViewBox(ctx: TransformerContext, svgText: string, viewBox: string): string {
    const hasViewBox = /\sviewBox\s*=\s*["'][^"']+["']/i.test(svgText);
    if (hasViewBox) return svgText;

    return svgText.replace(/<svg\b([^>]*)>/i, (full, attrs: string) => {
      return `<svg${attrs} viewBox="${viewBox}">`;
    });
}

export async function rasteriseSvgToRgba(
    ctx: TransformerContext,
    svgText: string,
    width: number,
    height: number,
  ): Promise<RasterImage> {
    const stamped = ctx.stampSvgSize(svgText, { width, height });

    const fontPath = join(process.cwd(), "data", "fonts", "LiberationSans.ttf");
    const fontFile = readFileSync(fontPath);

    const fontBytes = new Uint8Array(
      fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength),
    );

    const withFontFallback = ctx.injectTextFallbackCss(stamped, "Liberation Sans");

    const resvg = await ResvgTyped.async(withFontFallback, {
      fitTo: { mode: "original" },
      font: {
        loadSystemFonts: false,
        fontBuffers: [fontBytes],
        defaultFontFamily: "Liberation Sans",
        sansSerifFamily: "Liberation Sans",
        serifFamily: "Liberation Sans",
        monospaceFamily: "Liberation Sans",
        defaultFontSize: 12,
      },
    });

    const pngBytes = resvg.render().asPng();
    const raster = await ctx.decodePngToRgba(pngBytes);

    if (raster.width === width && raster.height === height) return raster;
    return ctx.resizeRaster(raster, { width, height });
}

export function injectTextFallbackCss(ctx: TransformerContext, svgText: string, family: string): string {
    const marker = "data-imagetx-font-fallback";
    if (svgText.includes(marker)) return svgText;

    const css = `text, tspan { font-family: "${family}", sans-serif !important; }`;
    const styleTag = `<style ${marker}="1"><![CDATA[${css}]]></style>`;

    return svgText.replace(/<svg\b([^>]*)>/i, (full, attrs: string) => `<svg${attrs}>${styleTag}`);
}

export function stampSvgSize(ctx: TransformerContext, svgText: string, spec: ResizeSpec): string {
    const hasSize = Boolean(spec.width || spec.height);
    if (!hasSize) return svgText;

    const w = spec.width ? `${spec.width}` : null;
    const h = spec.height ? `${spec.height}` : null;

    return svgText.replace(/<svg\b([^>]*)>/i, (full, attrs: string) => {
      const withWidth = ctx.upsertAttr(attrs, "width", w);
      const withHeight = ctx.upsertAttr(withWidth, "height", h);
      return `<svg${withHeight}>`;
    });
}

export function upsertAttr(ctx: TransformerContext, attrs: string, name: string, value: string | null): string {
    if (!value) return attrs;

    const re = new RegExp(`\\s${name}\\s*=\\s*["'][^"']*["']`, "i");
    if (re.test(attrs)) return attrs.replace(re, ` ${name}="${value}"`);

    return `${attrs} ${name}="${value}"`;
}

export function rasterToEmbeddedSvg(ctx: TransformerContext, img: RasterImage): SvgImage {
    const png = encodePng(img.rgba, img.width, img.height);
    const b64 = Buffer.from(png).toString("base64");

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}" viewBox="0 0 ${img.width} ${img.height}">` +
      `<image width="${img.width}" height="${img.height}" href="data:image/png;base64,${b64}" />` +
      `</svg>`;

    return { kind: "svg", svgText: svg };
}
