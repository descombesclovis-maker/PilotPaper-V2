export function normalizeFrenchVat(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const withCountry = normalized.startsWith("FR")
    ? normalized
    : normalized.length > 0
      ? `FR${normalized}`
      : "";

  return withCountry.slice(0, 13);
}

export function formatFrenchVat(value: string) {
  const vat = normalizeFrenchVat(value);
  if (!vat) return "";

  return [vat.slice(0, 2), vat.slice(2, 4), vat.slice(4, 13)]
    .filter(Boolean)
    .join(" ");
}

export function validateFrenchVat(value: string) {
  return /^FR[A-Z0-9]{2}\d{9}$/.test(normalizeFrenchVat(value));
}

export function sirenFromFrenchVat(value: string) {
  const vat = normalizeFrenchVat(value);
  return validateFrenchVat(vat) ? vat.slice(4) : "";
}
