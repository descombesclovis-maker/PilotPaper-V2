const ENABLED_TEST_EXPORT_VALUES = new Set(["1", "true", "yes", "on"]);

export type GenerationValidationStatus = "verified" | "test_unverified";

export function isExplicitTestExportEnabled(value: unknown) {
  const configured = String(value ?? "").trim().toLowerCase();
  return ENABLED_TEST_EXPORT_VALUES.has(configured);
}

export function generationValidationStatus(testExport: boolean): GenerationValidationStatus {
  return testExport ? "test_unverified" : "verified";
}
