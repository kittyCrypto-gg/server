export type SupportedFormat =
  | "svg"
  | "png"
  | "gif"
  | "bmp"
  | "jpg"
  | "jpeg"
  | "tiff"
  | "tif"
  | "webp";

export type ResizeSpec = {
  width?: number;
  height?: number;
};

export type RasterImage = {
  kind: "raster";
  width: number;
  height: number;
  rgba: Uint8Array;
};

export type SvgImage = {
  kind: "svg";
  svgText: string;
};

export type DecodedImage = RasterImage | SvgImage;

export type TransformRemoteUrlInput = {
  src: string;
  baseUrl?: string;
  format?: SupportedFormat;
  srcFormatHint?: SupportedFormat;
  resize?: ResizeSpec;
  requestHeaders?: Record<string, string>;
  nocache?: boolean;
  refresh?: boolean;
};

export type TransformBytesInput = {
  bytes: Uint8Array;
  originalUrlHint?: string;
  format?: SupportedFormat;
  srcFormatHint?: SupportedFormat;
  resize?: ResizeSpec;
  contentTypeHint?: string;
};

export type TransformResult = {
  body: Uint8Array;
  contentType: string;
  outputFormat: SupportedFormat;
  detectedSrcFormat: SupportedFormat;
  width: number;
  height: number;
};

export type TransformerLimits = {
  maxPixels: number;
  maxSrcBytes: number;
};

export type TransformerEncodeOptions = {
  jpegQuality: number;
};

export type ImageTransformerOptions = Partial<TransformerLimits & TransformerEncodeOptions>;

export type TransformErrorCode =
  | "BAD_REQUEST"
  | "FETCH_FAILED"
  | "UNSUPPORTED_FORMAT"
  | "PAYLOAD_TOO_LARGE"
  | "IMAGE_TOO_LARGE"
  | "DECODE_FAILED"
  | "TRANSFORM_FAILED"
  | "ENCODE_FAILED"
  | "INTERNAL";

export type TransformErrorStage =
  | "parse-source-url"
  | "validate-source-url"
  | "read-allowlist"
  | "fetch-source"
  | "read-source-body"
  | "detect-source-format"
  | "cache"
  | "pass-through"
  | "decode"
  | "transform"
  | "encode"
  | "internal";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type ImageTransformErrorDetails = Record<string, JsonValue>;

export type UnknownErrorSummary = {
  name: string;
  message: string;
  code?: string;
  errno?: number;
  syscall?: string;
  hostname?: string;
  address?: string;
  port?: number;
  stack?: string;
  cause?: UnknownErrorSummary;
};

export type ImageTransformErrorBody = {
  ok: false;
  error: {
    code: TransformErrorCode;
    httpStatus: number;
    message: string;
    stage: TransformErrorStage;
    details: ImageTransformErrorDetails;
    cause?: UnknownErrorSummary;
  };
};
export type ResvgRenderOptions = {
  fitTo?: { mode: "original" };
  font?: {
    loadSystemFonts?: boolean;
    fontFiles?: string[];
    fontDirs?: string[];
    fontBuffers?: Uint8Array[];
    defaultFontFamily?: string;
    sansSerifFamily?: string;
    serifFamily?: string;
    monospaceFamily?: string;
    defaultFontSize?: number;
  };
};

export type ResvgInstance = {
  render(): { asPng(): Uint8Array };
};

export type ResvgStatic = {
  async(svg: string, options?: ResvgRenderOptions): Promise<ResvgInstance>;
};

export type CacheIndexEntry = {
  fileName: string;
  createdAtMs: number;
  contentType: string;
  outputFormat: SupportedFormat;
  detectedSrcFormat: SupportedFormat;
  width: number;
  height: number;
};

export type CacheIndex = Record<string, CacheIndexEntry>;
export type SvgIntrinsicSize = {
  width?: number;
  height?: number;
  viewBox?: { w: number; h: number };
};
