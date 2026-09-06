import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeSuggestions, type Suggestion } from '../../../src/server/domain/suggestions.ts';
import type { ProductHistory, ProductPurchase } from '../../../src/server/domain/productStats.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', '..', 'fixtures', 'suggestions');

async function readFixture(name: string): Promise<{ today: string; histories: ProductHistory[] }> {
  const raw = await readFile(path.join(fixturesDir, name), 'utf-8');
  return JSON.parse(raw) as { today: string; histories: ProductHistory[] };
}

function history(
  productId: number,
  name: string,
  dates: string[],
  options: {
    category?: string | null;
    suppressed?: boolean;
    quantities?: number[];
    unit?: ProductPurchase['unit'];
  } = {},
): ProductHistory {
  return {
    productId,
    name,
    category: options.category ?? null,
    suppressed: options.suppressed ?? false,
    purchases: dates.map((date, i) => ({
      date,
      quantity: options.quantities?.[i] ?? 1,
      unit: options.unit ?? null,
    })),
  };
}

function byName(suggestions: Suggestion[], name: string): Suggestion | undefined {
  return suggestions.find((s) => s.name === name);
}

describe('computeSuggestions — worked example (architecture.md section 8)', () => {
  it('suggests milk (score 1.0, weekly reason), suggests coffee, skips stale flour and same-trip bananas', async () => {
    const { today, histories } = await readFixture('worked-example.json');

    const suggestions = computeSuggestions(histories, today);

    expect(byName(suggestions, 'Melk')).toMatchObject({
      score: 1,
      reason: 'Kjøpes ca. hver 7. dag, sist for 7 dager siden',
    });
    expect(byName(suggestions, 'Kaffe')).toBeDefined();
    expect(byName(suggestions, 'Mel')).toBeUndefined();
    expect(byName(suggestions, 'Bananer')).toBeUndefined();
    expect(byName(suggestions, 'Chips')).toBeUndefined();
  });

  it('gives a product bought every week a medianGap of 7, and one bought in weeks 30 and 33 a medianGap of 21', async () => {
    const { today, histories } = await readFixture('worked-example.json');

    const suggestions = computeSuggestions(histories, today);

    expect(byName(suggestions, 'Melk')?.reason).toContain('hver 7. dag');
    expect(byName(suggestions, 'Kaffe')?.reason).toBe(
      'Kjøpes ca. hver 21. dag, sist for 21 dager siden',
    );
  });
});

describe('computeSuggestions — one rule per test', () => {
  it('skips a product bought only once (fewer than two purchase weeks)', () => {
    const suggestions = computeSuggestions(
      [history(1, 'Engangsvare', ['2026-08-01'])],
      '2026-09-01',
    );

    expect(suggestions).toEqual([]);
  });

  it('skips a product bought twice in the same ISO week (fewer than two purchase weeks)', () => {
    const suggestions = computeSuggestions(
      [history(2, 'Samme uke', ['2026-08-31', '2026-09-01'])],
      '2026-09-10',
    );

    expect(suggestions).toEqual([]);
  });

  it('skips a product bought within the last three days, including exactly on the boundary', () => {
    const weekly = ['2026-08-07', '2026-08-14'];

    expect(computeSuggestions([history(3, 'Nettopp kjøpt', weekly)], '2026-08-17')).toEqual([]);
    expect(computeSuggestions([history(3, 'Nettopp kjøpt', weekly)], '2026-08-18')).not.toEqual([]);
  });

  it('skips a stale product (not bought for longer than max(60, 3x medianGap))', () => {
    const suggestions = computeSuggestions(
      [history(4, 'Gammelt', ['2026-06-01', '2026-06-15'])],
      '2026-09-04',
    );

    expect(suggestions).toEqual([]);
  });

  it('suggests via the due rule alone when the product is not frequent', () => {
    const suggestions = computeSuggestions(
      [history(5, 'Kryddermiks', ['2026-06-01', '2026-07-01'])],
      '2026-07-28',
    );

    expect(suggestions).toEqual([
      expect.objectContaining({
        name: 'Kryddermiks',
        reason: 'Kjøpes ca. hver 28. dag, sist for 27 dager siden',
      }),
    ]);
  });

  it('suggests via the frequency rule alone when the product is not due yet', () => {
    const suggestions = computeSuggestions(
      [
        history(6, 'Fruktpose', [
          '2026-06-01',
          '2026-06-15',
          '2026-06-29',
          '2026-07-13',
          '2026-07-27',
          '2026-08-10',
          '2026-08-24',
        ]),
      ],
      '2026-08-30',
    );

    expect(suggestions).toEqual([
      expect.objectContaining({
        name: 'Fruktpose',
        reason: 'Kjøpt 6 av de siste 12 ukene',
      }),
    ]);
  });

  it('never suggests a suppressed product, even with an otherwise-suggestible history', () => {
    const suggestions = computeSuggestions(
      [
        history(7, 'Undertrykt', ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28'], {
          suppressed: true,
        }),
      ],
      '2026-09-04',
    );

    expect(suggestions).toEqual([]);
  });
});

describe('computeSuggestions — quantityText', () => {
  it('rounds a median of 2 to "2 stk"', () => {
    const suggestions = computeSuggestions(
      [
        history(8, 'Stk-vare', ['2026-08-07', '2026-08-14', '2026-08-21'], {
          quantities: [1, 2, 3],
        }),
      ],
      '2026-08-28',
    );

    expect(suggestions[0]?.quantityText).toBe('2 stk');
  });

  it('formats a median of 1.135 kg as "1,1 kg"', () => {
    const suggestions = computeSuggestions(
      [
        history(9, 'Kg-vare', ['2026-08-07', '2026-08-14', '2026-08-21'], {
          quantities: [1.0, 1.135, 1.3],
          unit: 'kg',
        }),
      ],
      '2026-08-28',
    );

    expect(suggestions[0]?.quantityText).toBe('1,1 kg');
  });
});

describe('computeSuggestions — sorting', () => {
  it('sorts by score descending, then by name, stably', () => {
    const weekly = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28'];
    const suggestions = computeSuggestions(
      [history(10, 'Bravo', weekly), history(11, 'Alfa', weekly)],
      '2026-09-04',
    );

    expect(suggestions.map((s) => s.name)).toEqual(['Alfa', 'Bravo']);
  });

  it('formats a fractional (half-week) medianGap with a Norwegian comma', () => {
    const suggestions = computeSuggestions(
      [history(12, 'Delvis', ['2026-08-01', '2026-08-08', '2026-08-22'])],
      '2026-08-30',
    );

    expect(suggestions[0]?.reason).toBe('Kjøpes ca. hver 10,5. dag, sist for 8 dager siden');
  });
});
