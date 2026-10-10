import type { TransformerContext } from "./imageTransformer/context";
import { transformRemoteUrl as transformRemoteUrl_operation, transformBytes as transformBytes_operation } from "./imageTransformer/pipeline";
import type { TransformRemoteUrlInput, TransformBytesInput, TransformResult, ImageTransformerOptions, TransformerLimits, TransformerEncodeOptions } from "./imageTransformer/types";
import { ImageTransformerCacheMethods } from "./imageTransformer/facadeCache";

export type {
  SupportedFormat,
  ResizeSpec,
  TransformRemoteUrlInput,
  TransformBytesInput,
  TransformResult,
  ImageTransformerOptions,
  TransformErrorCode,
  TransformErrorStage,
  ImageTransformErrorDetails,
  ImageTransformErrorBody,
} from "./imageTransformer/types";
export { ImageTransformError, toImageTransformErrorBody, createImageTransformErrorBody } from "./imageTransformer/errors";

export class ImageTransformer extends ImageTransformerCacheMethods {
  private readonly limits: TransformerLimits;
  private readonly encodeOptions: TransformerEncodeOptions;

  public constructor(options?: ImageTransformerOptions) {
    super();
    this.limits = {
      maxPixels: options?.maxPixels ?? 20_000_000,
      maxSrcBytes: options?.maxSrcBytes ?? 25 * 1024 * 1024,
    };

    this.encodeOptions = {
      jpegQuality: options?.jpegQuality ?? 85,
    };
  }

  public async transformRemoteUrl(input: TransformRemoteUrlInput): Promise<TransformResult> {
    return transformRemoteUrl_operation(this as unknown as TransformerContext, input);
  }

  public async transformBytes(input: TransformBytesInput): Promise<TransformResult> {
    return transformBytes_operation(this as unknown as TransformerContext, input);
  }
}
