import { describe, expect, it } from 'vitest';
import { formatOre, parseNok } from '../../src/shared/money';

describe('parseNok', () => {
  it('parses a space-separated thousands amount with a decimal comma', () => {
    expect(parseNok('1 234,50')).toBe(123450);
  });

  it('parses a negative decimal-comma amount', () => {
    expect(parseNok('-5,00')).toBe(-500);
  });

  it('parses a decimal-point string', () => {
    expect(parseNok('43.80')).toBe(4380);
  });

  it('parses a plain number', () => {
    expect(parseNok(43.8)).toBe(4380);
  });

  it('throws on non-numeric input', () => {
    expect(() => parseNok('abc')).toThrow();
  });
});

describe('formatOre', () => {
  it('formats a positive amount', () => {
    expect(formatOre(4380)).toBe('43,80 kr');
  });

  it('formats a negative amount with the Unicode minus sign', () => {
    expect(formatOre(-500)).toBe('−5,00 kr');
  });
});
