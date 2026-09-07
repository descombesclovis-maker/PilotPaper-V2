export type DPExecutionMode = "test" | "standard" | "production";

export type DPExecutionPolicy = Readonly<{
  mode: DPExecutionMode;
  exposeGeneratedArtifactsOnQualityFailure: boolean;
  allowUnverifiedExport: boolean;
  blockOnQualityFailure: boolean;
  blockOnStructuralPdfFailure: boolean;
}>;

const POLICIES: Record<DPExecutionMode, DPExecutionPolicy> = {
  test: Object.freeze({
    mode: "test",
    exposeGeneratedArtifactsOnQualityFailure: true,
    allowUnverifiedExport: true,
    blockOnQualityFailure: false,
    blockOnStructuralPdfFailure: false,
  }),
  standard: Object.freeze({
    mode: "standard",
    exposeGeneratedArtifactsOnQualityFailure: true,
    allowUnverifiedExport: false,
    blockOnQualityFailure: false,
    blockOnStructuralPdfFailure: true,
  }),
  production: Object.freeze({
    mode: "production",
    exposeGeneratedArtifactsOnQualityFailure: false,
    allowUnverifiedExport: false,
    blockOnQualityFailure: true,
    blockOnStructuralPdfFailure: true,
  }),
};

export function normalizeExecutionMode(
  value: unknown,
  fallback: DPExecutionMode = "production",
): DPExecutionMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "test" ||
    normalized === "standard" ||
    normalized === "production"
  ) {
    return normalized;
  }
  return fallback;
}

export function executionPolicy(mode: DPExecutionMode): DPExecutionPolicy {
  return POLICIES[mode];
}

/**
 * Central execution-mode contract. HTTP/UI adapters resolve a mode once and
 * pass the policy downstream; individual generators and judges must not invent
 * their own TEST/STANDARD/PRODUCTION semantics.
 */
export function resolveExecutionPolicy(
  value: unknown,
  fallback: DPExecutionMode = "production",
): DPExecutionPolicy {
  return executionPolicy(normalizeExecutionMode(value, fallback));
}
