import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyExtraction } from '../../../src/server/domain/extraction.ts';
import { ExtractionError } from '../../../src/server/lib/errors.ts';
import { parseExtraction, type ExtractionResult } from '../../../src/server/llm/extractReceipt.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', '..', 'fixtures', 'llm');
const SCAN_DATE = '2026-09-03';

async function parseFixture(name: string): Promise<ExtractionResult> {
  const text = await readFile(path.join(fixturesDir, name), 'utf-8');
  return parseExtraction(text);
}

function remaLikeResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    storeName: 'REMA 1000 Grünerløkka',
    purchasedAt: '2026-09-03',
    total: 458.9,
    lines: [
      {
        text: 'TINE LETTMELK 1L',
        kind: 'item',
        quantity: 2,
        unit: 'stk',
        unitPrice: 50,
        totalPrice: 100,
      },
      {
        text: 'BANAN',
        kind: 'item',
        quantity: 1.135,
        unit: 'kg',
        unitPrice: 24.9,
        totalPrice: 150,
      },
      { text: 'PANT', kind: 'deposit', quantity: 4, unit: 'stk', unitPrice: 25, totalPrice: 100 },
      {
        text: 'KAFFE FILTERMALT 250G',
        kind: 'item',
        quantity: 1,
        unit: 'stk',
        unitPrice: 108.9,
        totalPrice: 108.9,
      },
    ],
    ...overrides,
  };
}

describe('applyExtraction', () => {
  it('parses the REMA fixture into 4 lines with totalOre 45890 and no warnings', async () => {
    const result = await parseFixture('extract-rema.json');

    const applied = applyExtraction(result, SCAN_DATE);

    expect(applied.lines).toHaveLength(4);
    expect(applied.totalOre).toBe(45890);
    expect(applied.warnings).toEqual([]);
  });

  it('parses the comma-decimal fixture to the same øre values as the REMA fixture', async () => {
    const rema = applyExtraction(await parseFixture('extract-rema.json'), SCAN_DATE);
    const comma = applyExtraction(await parseFixture('extract-comma-decimals.json'), SCAN_DATE);

    expect(comma.totalOre).toBe(rema.totalOre);
    expect(comma.lines.map((l) => l.totalOre)).toEqual(rema.lines.map((l) => l.totalOre));
    expect(comma.warnings).toEqual([]);
  });

  it('uses the scan date and adds MISSING_DATE when purchasedAt is missing', async () => {
    const result = await parseFixture('extract-missing-date.json');

    const applied = applyExtraction(result, SCAN_DATE);

    expect(applied.purchasedAt).toBe(SCAN_DATE);
    expect(applied.warnings).toContain('MISSING_DATE');
  });

  it('adds FUTURE_DATE when purchasedAt is later than the scan date', () => {
    const result = remaLikeResult({ purchasedAt: '2026-09-10' });

    const applied = applyExtraction(result, SCAN_DATE);

    expect(applied.warnings).toContain('FUTURE_DATE');
    expect(applied.purchasedAt).toBe('2026-09-10');
  });

  it('adds MISSING_STORE when storeName is null', () => {
    const result = remaLikeResult({ storeName: null });

    const applied = applyExtraction(result, SCAN_DATE);

    expect(applied.warnings).toContain('MISSING_STORE');
  });

  it('adds TOTAL_MISMATCH when the total is off by 1,50 kr', () => {
    const result = remaLikeResult({ total: 460.4 }); // 458.90 + 1.50

    const applied = applyExtraction(result, SCAN_DATE);

    expect(applied.warnings).toContain('TOTAL_MISMATCH');
  });

  it('does not add TOTAL_MISMATCH when the total is off by only 0,50 kr', () => {
    const result = remaLikeResult({ total: 459.4 }); // 458.90 + 0.50

    const applied = applyExtraction(result, SCAN_DATE);

    expect(applied.warnings).not.toContain('TOTAL_MISMATCH');
  });

  it('sets totalOre to the line sum and adds TOTAL_MISMATCH when total is null', () => {
    const result = remaLikeResult({ total: null });

    const applied = applyExtraction(result, SCAN_DATE);

    expect(applied.totalOre).toBe(45890);
    expect(applied.warnings).toContain('TOTAL_MISMATCH');
  });

  it('excludes an other-kind footer line from the total check, so a duplicated sum line causes no mismatch', async () => {
    const result = await parseFixture('extract-footer-lines.json');

    const applied = applyExtraction(result, SCAN_DATE);

    expect(applied.lines).toHaveLength(5);
    expect(applied.warnings).not.toContain('TOTAL_MISMATCH');
  });

  it('throws "Fant ingen varelinjer" when there are no item lines', () => {
    const result = remaLikeResult({
      lines: [
        { text: 'PANT', kind: 'deposit', quantity: 1, unit: 'stk', unitPrice: 3, totalPrice: 3 },
      ],
    });

    expect(() => applyExtraction(result, SCAN_DATE)).toThrow(ExtractionError);
    try {
      applyExtraction(result, SCAN_DATE);
      expect.unreachable();
    } catch (error) {
      expect((error as ExtractionError).userMessage).toBe('Fant ingen varelinjer');
    }
  });

  it('converts the odd-units fixture into correct øre lines', async () => {
    const result = await parseFixture('extract-odd-units.json');

    const applied = applyExtraction(result, SCAN_DATE);

    expect(applied.lines[0]).toMatchObject({ quantity: 0.5, unit: 'kg', totalOre: 2000 });
    expect(applied.lines[1]).toMatchObject({ quantity: 0.5, unit: 'l', totalOre: 5000 });
    expect(applied.lines[3]).toMatchObject({ kind: 'other', totalOre: -2000 });
  });

  it('assigns 1-based lineNo in the printed order', () => {
    const applied = applyExtraction(remaLikeResult(), SCAN_DATE);

    expect(applied.lines.map((l) => l.lineNo)).toEqual([1, 2, 3, 4]);
  });
});
