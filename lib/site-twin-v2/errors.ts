export type SiteTwinFailureCode =
  | "PROPERTY_LOCK_FAILED"
  | "PROPERTY_AMBIGUOUS"
  | "GOOGLE_DATALAYERS_UNAVAILABLE"
  | "GOOGLE_DSM_DOWNLOAD_FAILED"
  | "IGN_ELEVATION_UNAVAILABLE"
  | "GEOMETRY_ENGINE_OFFLINE"
  | "GEOMETRY_ENGINE_TIMEOUT"
  | "GEOMETRY_RECONSTRUCTION_FAILED"
  | "ROOF_FACE_COUNT_SUSPECT"
  | "ROOF_GEOMETRY_LOW_CONFIDENCE"
  | "CAMERA_REGISTRATION_FAILED"
  | "PHOTO_NORMALIZATION_FAILED"
  | "PV_LAYOUT_INVALID"
  | "CROSS_PIECE_INCONSISTENCY"
  | "SOURCE_CONFLICT"
  | "UNSUPPORTED_SITE";

export class SiteTwinError extends Error {
  readonly code: SiteTwinFailureCode;
  readonly recoverable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: SiteTwinFailureCode,
    message: string,
    options: { recoverable?: boolean; cause?: unknown; details?: Record<string, unknown> } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "SiteTwinError";
    this.code = code;
    this.recoverable = options.recoverable ?? false;
    this.details = options.details;
  }
}

export function asSiteTwinError(
  error: unknown,
  fallbackCode: SiteTwinFailureCode,
  fallbackMessage: string,
) {
  if (error instanceof SiteTwinError) return error;
  return new SiteTwinError(fallbackCode, error instanceof Error ? error.message : fallbackMessage, {
    cause: error,
  });
}
