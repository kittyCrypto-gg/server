import type { Request, Response } from "express";
import * as ImageTransformer from "../imageTransformer";
import type * as types from "../types";

export function parseImgQuery(req: Request): types.ImgQueryParseResult {
    const src = readTrimmedQueryString(req, "src");
    if (!src) {
        return { ok: false, httpStatus: 400, message: "Missing mandatory query param: src" };
    }

    const formatRaw = readTrimmedQueryString(req, "format");
    const format = normaliseImgFormat(formatRaw);
    if (formatRaw && !format) {
        return { ok: false, httpStatus: 400, message: "Invalid format. Use png|jpg|jpeg|gif|bmp|svg|tif|tiff" };
    }

    const srcFormatHintRaw = readTrimmedQueryString(req, "srcFormatHint") || readTrimmedQueryString(req, "srcFormat");
    const srcFormatHint = normaliseImgFormat(srcFormatHintRaw);
    if (srcFormatHintRaw && !srcFormatHint) {
        return {
            ok: false,
            httpStatus: 400,
            message: "Invalid srcFormat/srcFormatHint. Use png|jpg|jpeg|gif|bmp|svg|tif|tiff"
        };
    }

    const width = parsePositiveInt(readTrimmedQueryString(req, "width"));
    const height = parsePositiveInt(readTrimmedQueryString(req, "height"));

    return {
        ok: true,
        src,
        format,
        srcFormatHint,
        resize: { width: width ?? undefined, height: height ?? undefined }
    };
}

export function readTrimmedQueryString(req: Request, key: string): string {
    const raw = req.query[key];
    if (typeof raw !== "string") return "";
    return raw.trim();
}

export function normaliseImgFormat(value: string): ImageTransformer.SupportedFormat | null {
    if (!value) return null;

    switch (value.toLowerCase()) {
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
        default:
            return null;
    }
}

export function parsePositiveInt(value: string): number | null {
    if (!value) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const i = Math.floor(n);
    return i > 0 ? i : null;
}

export function buildRequestBaseUrl(req: Request): string | undefined {
    const host = typeof req.headers.host === "string" ? req.headers.host : "";
    if (!host) return undefined;

    const proto = typeof req.protocol === "string" ? req.protocol : "https";
    return `${proto}://${host}${req.originalUrl}`;
}

export function sendImgResult(res: Response, result: types.ImgResultShape): void {
    res.status(200);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(Buffer.from(result.body));
}

export function sendImgError(res: Response, err: unknown): void {
    const body = ImageTransformer.toImageTransformErrorBody(err, {
        includeStack: process.env.NODE_ENV !== "production"
    });

    res.status(body.error.httpStatus).json(body);
}
