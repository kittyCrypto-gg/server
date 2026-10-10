import type { TransformerContext } from "./context";
import type { SupportedFormat, ResizeSpec, RasterImage, SvgImage, DecodedImage, TransformResult, ImageTransformErrorDetails, CacheIndex, SvgIntrinsicSize } from "./types";
import { ImageTransformerRenderingMethods } from "./facadeRendering";
import { cacheKeyFromRemoteRequest as cacheKeyFromRemoteRequest_operation, ensureCacheDir as ensureCacheDir_operation, readCacheIndex as readCacheIndex_operation, writeCacheIndex as writeCacheIndex_operation, purgeExpiredCacheEntries as purgeExpiredCacheEntries_operation, tryLoadFromCache as tryLoadFromCache_operation, extensionForContentType as extensionForContentType_operation, saveToCache as saveToCache_operation } from "./cache";

/** Internal ImageTransformer delegation methods: cache. */
export class ImageTransformerCacheMethods extends ImageTransformerRenderingMethods {
  private cacheKeyFromRemoteRequest(args: {
    srcUrl: string;
    outputFormat: SupportedFormat;
    resize: ResizeSpec;
    detectedSrcFormatHint: SupportedFormat;
  }): string {
    return cacheKeyFromRemoteRequest_operation(this as unknown as TransformerContext, args);
  }

  private async ensureCacheDir(): Promise<void> {
    return ensureCacheDir_operation(this as unknown as TransformerContext);
  }

  private async readCacheIndex(): Promise<CacheIndex> {
    return readCacheIndex_operation(this as unknown as TransformerContext);
  }

  private async writeCacheIndex(index: CacheIndex): Promise<void> {
    return writeCacheIndex_operation(this as unknown as TransformerContext, index);
  }

  private async purgeExpiredCacheEntries(index: CacheIndex): Promise<boolean> {
    return purgeExpiredCacheEntries_operation(this as unknown as TransformerContext, index);
  }

  private async tryLoadFromCache(args: {
    kind: "remote";
    srcUrl: string;
    outputFormat: SupportedFormat;
    resize: ResizeSpec;
    detectedSrcFormatHint: SupportedFormat;
  }): Promise<TransformResult | null> {
    return tryLoadFromCache_operation(this as unknown as TransformerContext, args);
  }

  private extensionForContentType(contentType: string): string {
    return extensionForContentType_operation(this as unknown as TransformerContext, contentType);
  }

  private async saveToCache(
    args: {
      kind: "remote";
      srcUrl: string;
      outputFormat: SupportedFormat;
      resize: ResizeSpec;
      detectedSrcFormatHint: SupportedFormat;
    },
    result: TransformResult,
  ): Promise<void> {
    return saveToCache_operation(this as unknown as TransformerContext, args, result);
  }
}
