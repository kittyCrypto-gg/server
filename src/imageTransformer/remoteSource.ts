import type { TransformerContext } from "./context";
import type { ImageTransformErrorDetails } from "./types";
import { ImageTransformError } from "./errors";

export function resolveSrcUrlWithDetail(ctx: TransformerContext, src: string, baseUrl?: string): URL {
    try {
      return ctx.resolveSrcUrl(src, baseUrl);
    } catch (error) {
      throw new ImageTransformError({
        code: "BAD_REQUEST",
        httpStatus: 400,
        message: "Invalid image source URL",
        stage: "parse-source-url",
        details: {
          src,
          baseUrl: baseUrl ?? null,
        },
        cause: error,
      });
    }
}

export function parseOptionalUrlHint(ctx: TransformerContext, originalUrlHint?: string): URL | null {
    if (!originalUrlHint) return null;

    try {
      return new URL(originalUrlHint);
    } catch (error) {
      throw new ImageTransformError({
        code: "BAD_REQUEST",
        httpStatus: 400,
        message: "Invalid originalUrlHint",
        stage: "parse-source-url",
        details: {
          originalUrlHint,
        },
        cause: error,
      });
    }
}

export async function fetchRemoteSource(ctx: TransformerContext, srcUrl: URL, requestHeaders?: Record<string, string>): Promise<Response> {
    const acceptHeader = "image/*,application/octet-stream;q=0.9,*/*;q=0.1";

    let response: Response;
    try {
      response = await fetch(srcUrl.toString(), {
        headers: {
          Accept: acceptHeader,
          ...(requestHeaders ?? {}),
        },
      });
    } catch (error) {
      throw new ImageTransformError({
        code: "FETCH_FAILED",
        httpStatus: 502,
        message: "Network fetch failed before a response was received",
        stage: "fetch-source",
        details: {
          ...ctx.sourceDetails(srcUrl),
          requestAccept: acceptHeader,
        },
        cause: error,
      });
    }

    if (response.ok) return response;

    throw new ImageTransformError({
      code: "FETCH_FAILED",
      httpStatus: 502,
      message: `Source server returned HTTP ${response.status}`,
      stage: "fetch-source",
      details: {
        ...ctx.sourceDetails(srcUrl),
        responseUrl: response.url || srcUrl.toString(),
        responseStatus: response.status,
        responseStatusText: response.statusText,
        responseHeaders: ctx.headersToJsonObject(response.headers),
      },
    });
}

export async function readResponseBytes(ctx: TransformerContext, response: Response, srcUrl: URL): Promise<Uint8Array> {
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw new ImageTransformError({
        code: "FETCH_FAILED",
        httpStatus: 502,
        message: "Fetched source but failed while reading response body",
        stage: "read-source-body",
        details: {
          ...ctx.sourceDetails(srcUrl),
          responseUrl: response.url || srcUrl.toString(),
          responseStatus: response.status,
          responseHeaders: ctx.headersToJsonObject(response.headers),
        },
        cause: error,
      });
    }
}

export function resolveSrcUrl(ctx: TransformerContext, src: string, baseUrl?: string): URL {
    const base = baseUrl ? new URL(baseUrl) : undefined;
    return base ? new URL(src, base) : new URL(src);
}

export function assertByteBudget(ctx: TransformerContext, byteLength: number, details: ImageTransformErrorDetails): void {
    if (byteLength <= ctx.limits.maxSrcBytes) return;

    throw new ImageTransformError({
      code: "PAYLOAD_TOO_LARGE",
      httpStatus: 400,
      message: "Source image is too large",
      stage: "read-source-body",
      details: {
        ...details,
        byteLength,
        maxSrcBytes: ctx.limits.maxSrcBytes,
      },
    });
}

export function assertPixelBudget(ctx: TransformerContext, w: number, h: number): void {
    const pixels = w * h;
    if (pixels <= ctx.limits.maxPixels) return;

    throw new ImageTransformError({
      code: "IMAGE_TOO_LARGE",
      httpStatus: 400,
      message: `Image too large: ${w}x${h} (${pixels} pixels)`,
      stage: "decode",
      details: {
        width: w,
        height: h,
        pixels,
        maxPixels: ctx.limits.maxPixels,
      },
    });
}
