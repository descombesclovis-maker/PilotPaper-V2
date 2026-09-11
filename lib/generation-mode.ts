const ENABLED_TEST_EXPORT_VALUES = new Set(["1", "true", "yes", "on"]);

export function isExplicitTestExportEnabled(value: unknown) {
  const configured = String(value ?? "").trim().toLowerCase();
  return ENABLED_TEST_EXPORT_VALUES.has(configured);
}
