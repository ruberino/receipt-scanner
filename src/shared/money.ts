// Optional sign, digits with optional 3-digit groups separated by one whitespace character
// (space, U+00A0, U+202F), optional decimal comma or point. Whitespace anywhere else is invalid.
const DECIMAL_PATTERN = /^(-?)(\d{1,3}(?:\s\d{3})+|\d+)(?:[.,](\d+))?$/u;

type DecimalParts = { negative: boolean; integer: string; fraction: string };

function invalidAmount(value: string | number): Error {
  return new Error(`Invalid amount: ${JSON.stringify(value)}`);
}

function splitDecimal(value: string): DecimalParts {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) {
    throw invalidAmount(value);
  }
  return {
    negative: match[1] === '-',
    integer: (match[2] ?? '').replace(/\s/gu, ''),
    fraction: match[3] ?? '',
  };
}

/**
 * Parses "43,80", "43.80", "1 234,50", "1,135" or a number into a plain decimal number.
 * Not øre; use this for quantities and `parseNok` for money.
 */
export function parseDecimal(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalidAmount(value);
    }
    return value === 0 ? 0 : value;
  }
  const { negative, integer, fraction } = splitDecimal(value);
  const magnitude = Number(fraction ? `${integer}.${fraction}` : integer);
  if (!Number.isFinite(magnitude)) {
    throw invalidAmount(value);
  }
  return negative && magnitude !== 0 ? -magnitude : magnitude;
}

/** Parses a NOK amount with at most two decimals ("43,80", "1 234,50", 43.8, "-5,00") into integer øre. */
export function parseNok(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalidAmount(value);
    }
    const ore = value * 100;
    const rounded = Math.round(ore);
    if (!Number.isSafeInteger(rounded) || Math.abs(ore - rounded) > 1e-6) {
      throw invalidAmount(value);
    }
    return rounded === 0 ? 0 : rounded;
  }
  const { negative, integer, fraction } = splitDecimal(value);
  if (fraction.length > 2) {
    throw invalidAmount(value);
  }
  const ore = Number(integer) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(ore)) {
    throw invalidAmount(value);
  }
  return negative && ore !== 0 ? -ore : ore;
}

const NOK_FORMATTER = new Intl.NumberFormat('nb-NO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats integer øre as "43,80 kr"; the space before "kr" is U+00A0 and the minus sign is U+2212. */
export function formatOre(ore: number): string {
  if (!Number.isSafeInteger(ore)) {
    throw new Error(`Amount must be integer øre: ${String(ore)}`);
  }
  return `${NOK_FORMATTER.format((ore === 0 ? 0 : ore) / 100)}\u00A0kr`;
}
