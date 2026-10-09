import type { TransformErrorCode, TransformErrorStage, ImageTransformErrorDetails, ImageTransformErrorBody, UnknownErrorSummary } from "./types";

export class ImageTransformError extends Error {
  public readonly code: TransformErrorCode;
  public readonly httpStatus: number;
  public readonly stage: TransformErrorStage;
  public readonly details: ImageTransformErrorDetails;
  public readonly causeValue?: unknown;

  public constructor(args: {
    code: TransformErrorCode;
    httpStatus: number;
    message: string;
    stage: TransformErrorStage;
    details?: ImageTransformErrorDetails;
    cause?: unknown;
  }) {
    super(args.message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = "ImageTransformError";
    this.code = args.code;
    this.httpStatus = args.httpStatus;
    this.stage = args.stage;
    this.details = args.details ?? {};
    this.causeValue = args.cause;
  }

  public toBody(options?: { includeStack?: boolean }): ImageTransformErrorBody {
    const body: ImageTransformErrorBody = {
      ok: false,
      error: {
        code: this.code,
        httpStatus: this.httpStatus,
        message: this.message,
        stage: this.stage,
        details: this.details,
      },
    };

    if (this.causeValue !== undefined) {
      body.error.cause = summariseUnknownError(this.causeValue, Boolean(options?.includeStack));
    }

    return body;
  }
}

export function toImageTransformErrorBody(
  error: unknown,
  options?: { includeStack?: boolean },
): ImageTransformErrorBody {
  if (error instanceof ImageTransformError) {
    return error.toBody(options);
  }

  return {
    ok: false,
    error: {
      code: "INTERNAL",
      httpStatus: 500,
      message: "Unexpected image transform failure",
      stage: "internal",
      details: {},
      cause: summariseUnknownError(error, Boolean(options?.includeStack)),
    },
  };
}

export function createImageTransformErrorBody(args: {
  code: TransformErrorCode;
  httpStatus: number;
  message: string;
  stage: TransformErrorStage;
  details?: ImageTransformErrorDetails;
  cause?: unknown;
  includeStack?: boolean;
}): ImageTransformErrorBody {
  const error = new ImageTransformError(args);
  return error.toBody({ includeStack: args.includeStack });
}

type ErrorRecord = Record<string, unknown>;
export function summariseUnknownError(error: unknown, includeStack: boolean, depth = 0): UnknownErrorSummary {
  if (depth > 4) {
    return {
      name: "CauseChainTruncated",
      message: "Nested cause chain truncated",
    };
  }

  if (!(error instanceof Error)) {
    return {
      name: typeof error,
      message: String(error),
    };
  }

  const record = error as unknown as ErrorRecord;
  const summary: UnknownErrorSummary = {
    name: error.name || "Error",
    message: error.message || "Unknown error",
  };

  const code = readStringField(record, "code");
  if (code) summary.code = code;

  const errno = readNumberField(record, "errno");
  if (errno !== null) summary.errno = errno;

  const syscall = readStringField(record, "syscall");
  if (syscall) summary.syscall = syscall;

  const hostname = readStringField(record, "hostname");
  if (hostname) summary.hostname = hostname;

  const address = readStringField(record, "address");
  if (address) summary.address = address;

  const port = readNumberField(record, "port");
  if (port !== null) summary.port = port;

  if (includeStack && error.stack) {
    summary.stack = error.stack;
  }

  if (record.cause !== undefined) {
    summary.cause = summariseUnknownError(record.cause, includeStack, depth + 1);
  }

  return summary;
}

function readStringField(record: ErrorRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumberField(record: ErrorRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

