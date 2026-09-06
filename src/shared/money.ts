const AMOUNT_RE = /^-?\d+(\.\d+)?$/;

/** Parses a NOK amount (number or decimal-comma/decimal-point string, with optional space thousands separators) into integer ore. */
export function parseNok(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid amount: ${value}`);
    }
    return Math.round(value * 100);
  }
  let normalized = value.trim().replace(/\s/g, '');
  if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  if (!AMOUNT_RE.test(normalized)) {
    throw new Error(`Invalid amount: ${value}`);
  }
  return Math.round(Number(normalized) * 100);
}

const NOK_FORMATTER = new Intl.NumberFormat('nb-NO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats integer ore as a Norwegian amount, e.g. "43,80 kr" (the space before "kr" is U+00A0, a non-breaking space). */
export function formatOre(ore: number): string {
  return NOK_FORMATTER.format(ore / 100) + ' kr';
}
