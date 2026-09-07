export function normalizeSiret(value: string) {
  return value.replace(/\D/g, "").slice(0, 14);
}

export function formatSiret(value: string) {
  const digits = normalizeSiret(value);
  return [
    digits.slice(0, 3),
    digits.slice(3, 6),
    digits.slice(6, 9),
    digits.slice(9, 14),
  ]
    .filter(Boolean)
    .join(" ");
}

function isLuhnValid(value: string) {
  let sum = 0;
  let shouldDouble = false;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function isLaPosteExceptionValid(value: string) {
  if (!value.startsWith("356000000")) return false;
  const sum = [...value].reduce((total, digit) => total + Number(digit), 0);
  return sum % 5 === 0;
}

export function validateSiret(value: string) {
  const siret = normalizeSiret(value);
  return (
    siret.length === 14 &&
    (isLuhnValid(siret) || isLaPosteExceptionValid(siret))
  );
}
