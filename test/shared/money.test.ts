import { describe, expect, it } from 'vitest';
import { formatOre, parseDecimal, parseNok } from '../../src/shared/money.ts';

const NBSP = '\u00A0';
const MINUS = '\u2212';

describe('parseNok', () => {
  it('parses the documented forms', () => {
    expect(parseNok('1 234,50')).toBe(123450);
    expect(parseNok('-5,00')).toBe(-500);
    expect(parseNok('43,80')).toBe(4380);
    expect(parseNok('43.80')).toBe(4380);
    expect(parseNok(43.8)).toBe(4380);
  });

  it('accepts one decimal, no decimals, and a non-breaking thousands separator', () => {
    expect(parseNok('43,8')).toBe(4380);
    expect(parseNok('43')).toBe(4300);
    expect(parseNok(`1${NBSP}234,50`)).toBe(123450);
    expect(parseNok('  12,00  ')).toBe(1200);
  });

  it('normalises negative zero to zero', () => {
    expect(Object.is(parseNok('-0,00'), 0)).toBe(true);
    expect(Object.is(parseNok(-0), 0)).toBe(true);
  });

  it.each([
    'abc',
    '',
    '4 3,80',
    '1 2 3',
    '- 5,00',
    '12,345',
    '43,805',
    '1.234,50',
    '1,234.50',
    '43,80 kr',
    '1'.repeat(400),
    '99999999999999999',
  ])('throws on %j', (input) => {
    expect(() => parseNok(input)).toThrow(/Invalid amount/);
  });

  it.each([1.005, 0.001, Number.NaN, Number.POSITIVE_INFINITY, 1e20])(
    'throws on the number %s',
    (input) => {
      expect(() => parseNok(input)).toThrow(/Invalid amount/);
    },
  );
});

describe('parseDecimal', () => {
  it('parses quantities with more than two decimals', () => {
    expect(parseDecimal('1,135')).toBe(1.135);
    expect(parseDecimal('1.135')).toBe(1.135);
    expect(parseDecimal('1 234,5')).toBe(1234.5);
    expect(parseDecimal('-2,5')).toBe(-2.5);
    expect(parseDecimal(2)).toBe(2);
  });

  it('throws on garbage, interior spaces and non-finite numbers', () => {
    expect(() => parseDecimal('abc')).toThrow(/Invalid amount/);
    expect(() => parseDecimal('4 3')).toThrow(/Invalid amount/);
    expect(() => parseDecimal(Number.NaN)).toThrow(/Invalid amount/);
  });
});

describe('formatOre', () => {
  it('formats a positive amount with a non-breaking space before kr', () => {
    expect(formatOre(4380)).toBe(`43,80${NBSP}kr`);
  });

  it('formats a negative amount with the Unicode minus sign', () => {
    expect(formatOre(-500)).toBe(`${MINUS}5,00${NBSP}kr`);
  });

  it('groups thousands with a non-breaking space', () => {
    expect(formatOre(123450)).toBe(`1${NBSP}234,50${NBSP}kr`);
  });

  it('formats small and zero amounts without a sign', () => {
    expect(formatOre(5)).toBe(`0,05${NBSP}kr`);
    expect(formatOre(0)).toBe(`0,00${NBSP}kr`);
    expect(formatOre(-0)).toBe(`0,00${NBSP}kr`);
  });

  it('rejects anything that is not integer øre', () => {
    expect(() => formatOre(4380.5)).toThrow(/integer øre/);
    expect(() => formatOre(Number.NaN)).toThrow(/integer øre/);
    expect(() => formatOre(Number.POSITIVE_INFINITY)).toThrow(/integer øre/);
  });
});
