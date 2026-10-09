import type { TransformerContext } from "./context";
import type { ResizeSpec, ImageTransformErrorDetails } from "./types";
import { ImageTransformError } from "./errors";

export function headersToJsonObject(ctx: TransformerContext, headers: Headers): ImageTransformErrorDetails {
    const out: ImageTransformErrorDetails = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
}

export function sourceDetails(ctx: TransformerContext, srcUrl: URL): ImageTransformErrorDetails {
    return {
      srcUrl: srcUrl.toString(),
      protocol: srcUrl.protocol,
      hostname: srcUrl.hostname,
      pathname: srcUrl.pathname,
    };
}

export function resizeSpecDetails(ctx: TransformerContext, spec: ResizeSpec): ImageTransformErrorDetails {
    return {
      width: spec.width ?? null,
      height: spec.height ?? null,
    };
}

export function firstBytesHex(ctx: TransformerContext, bytes: Uint8Array): string {
    return Buffer.from(bytes.slice(0, 32)).toString("hex");
}
