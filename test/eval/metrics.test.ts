import { describe, expect, it } from 'vitest';
import type { ExtractionResult } from '../../src/server/llm/extractReceipt.ts';
import {
  aggregateMetrics,
  computeReceiptMetrics,
  dateMatch,
  itemRecall,
  lineCountDiff,
  priceAccuracy,
  storeMatch,
  totalWithin1kr,
  type ExpectedReceipt,
} from '../../eval/metrics.ts';

function expected(overrides: Partial<ExpectedReceipt> = {}): ExpectedReceipt {
  return {
    storeName: 'Kiwi',
    purchasedAt: '2026-09-03',
    total: 458.9,
    items: [
      { text: 'TINE LETTMELK 1L', totalPrice: 100 },
      { text: 'BANAN', totalPrice: 150 },
      { text: 'KAFFE FILTERMALT 250G', totalPrice: 108.9 },
    ],
    ...overrides,
  };
}

function line(
  text: string,
  totalPrice: number,
  kind: ExtractionResult['lines'][number]['kind'] = 'item',
): ExtractionResult['lines'][number] {
  return { text, kind, quantity: 1, unit: null, unitPrice: null, totalPrice };
}

function result(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    storeName: 'KIWI Torshov',
    purchasedAt: '2026-09-03',
    total: 458.9,
    lines: [
      line('TINE LETTMELK 1L', 100),
      line('BANAN', 150),
      line('PANT', 100, 'deposit'),
      line('KAFFE FILTERMALT 250G', 108.9),
    ],
    ...overrides,
  };
}

describe('dateMatch', () => {
  it('matches identical dates', () => {
    expect(dateMatch(expected(), result())).toBe(true);
  });

  it('does not match a different date', () => {
    expect(dateMatch(expected(), result({ purchasedAt: '2026-09-04' }))).toBe(false);
  });

  it('does not match a null extracted date', () => {
    expect(dateMatch(expected(), result({ purchasedAt: null }))).toBe(false);
  });
});

describe('storeMatch', () => {
  it('matches when the expected name is a substring of the extracted one', () => {
    expect(storeMatch(expected(), result())).toBe(true);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(
      storeMatch(expected({ storeName: 'kiwi!' }), result({ storeName: 'KIWI Torshov' })),
    ).toBe(true);
  });

  it('does not match an unrelated store name', () => {
    expect(storeMatch(expected(), result({ storeName: 'Rema 1000' }))).toBe(false);
  });

  it('does not match a null extracted store', () => {
    expect(storeMatch(expected(), result({ storeName: null }))).toBe(false);
  });
});

describe('totalWithin1kr', () => {
  it('matches an identical total', () => {
    expect(totalWithin1kr(expected(), result())).toBe(true);
  });

  it('matches within 1 kr', () => {
    expect(totalWithin1kr(expected({ total: 458 }), result({ total: 458.9 }))).toBe(true);
  });

  it('does not match more than 1 kr off', () => {
    expect(totalWithin1kr(expected({ total: 450 }), result({ total: 458.9 }))).toBe(false);
  });

  it('does not match a null extracted total', () => {
    expect(totalWithin1kr(expected(), result({ total: null }))).toBe(false);
  });
});

describe('itemRecall', () => {
  it('is 1 when every expected item is found', () => {
    expect(itemRecall(expected(), result())).toBe(1);
  });

  it('is 1 when there are no expected items', () => {
    expect(itemRecall(expected({ items: [] }), result())).toBe(1);
  });

  it('counts a match regardless of the extracted line kind', () => {
    const withMisclassifiedLine = result({
      lines: [
        line('TINE LETTMELK 1L', 100),
        line('BANAN', 150, 'other'),
        line('PANT', 100, 'deposit'),
      ],
    });
    expect(
      itemRecall(expected({ items: expected().items.slice(0, 2) }), withMisclassifiedLine),
    ).toBe(1);
  });

  it('is a fraction when some expected items are missing', () => {
    const missingOne = result({ lines: [line('TINE LETTMELK 1L', 100), line('BANAN', 150)] });
    expect(itemRecall(expected(), missingOne)).toBeCloseTo(2 / 3);
  });

  it('does not double-count one extracted line for two identical expected items', () => {
    const oneLineOnly = result({ lines: [line('TINE LETTMELK 1L', 100)] });
    const twoIdenticalExpected = expected({
      items: [
        { text: 'TINE LETTMELK 1L', totalPrice: 100 },
        { text: 'TINE LETTMELK 1L', totalPrice: 100 },
      ],
    });
    expect(itemRecall(twoIdenticalExpected, oneLineOnly)).toBeCloseTo(0.5);
  });
});

describe('priceAccuracy', () => {
  it('is 1 when every matched item has the same øre total', () => {
    expect(priceAccuracy(expected(), result())).toBe(1);
  });

  it('is 0 when nothing matched', () => {
    expect(priceAccuracy(expected(), result({ lines: [line('UKJENT VARE', 1)] }))).toBe(0);
  });

  it('only counts matched items, ignoring ones that were never found', () => {
    const missingOneWrongPriceOnOther = result({
      lines: [line('TINE LETTMELK 1L', 999), line('BANAN', 150)],
    });
    // Matched: TINE (wrong price) and BANAN (right price); KAFFE never matched at all.
    expect(priceAccuracy(expected(), missingOneWrongPriceOnOther)).toBeCloseTo(0.5);
  });

  it('rounds to the nearest øre instead of failing on float noise', () => {
    const almostEqual = result({
      lines: [
        line('TINE LETTMELK 1L', 100.001),
        line('BANAN', 150),
        line('KAFFE FILTERMALT 250G', 108.9),
      ],
    });
    expect(priceAccuracy(expected(), almostEqual)).toBe(1);
  });
});

describe('lineCountDiff', () => {
  it('is positive when the model over-extracts relative to the expected items', () => {
    expect(lineCountDiff(expected(), result())).toBe(1);
  });

  it('is 0 when the counts match', () => {
    expect(lineCountDiff(expected(), result({ lines: result().lines.slice(0, 3) }))).toBe(0);
  });
});

describe('computeReceiptMetrics', () => {
  it('combines every metric for one receipt', () => {
    expect(computeReceiptMetrics(expected(), result())).toEqual({
      dateMatch: true,
      storeMatch: true,
      totalWithin1kr: true,
      itemRecall: 1,
      priceAccuracy: 1,
      lineCountDiff: 1,
    });
  });
});

describe('aggregateMetrics', () => {
  it('rates booleans as a share true and averages the fractional metrics', () => {
    const perfect = computeReceiptMetrics(expected(), result());
    const partial = computeReceiptMetrics(
      expected(),
      result({ lines: [line('TINE LETTMELK 1L', 100), line('BANAN', 150)] }),
    );

    const aggregate = aggregateMetrics([perfect, partial]);

    expect(aggregate.receiptCount).toBe(2);
    expect(aggregate.dateMatchRate).toBe(1);
    expect(aggregate.storeMatchRate).toBe(1);
    expect(aggregate.totalWithin1krRate).toBe(1);
    expect(aggregate.meanItemRecall).toBeCloseTo((1 + 2 / 3) / 2);
    expect(aggregate.meanPriceAccuracy).toBeCloseTo(1);
    // perfect: 4 lines vs 3 expected items (+1, abs 1); partial: 2 lines vs 3 (-1, abs 1).
    expect(aggregate.meanAbsLineCountDiff).toBeCloseTo(1);
  });

  it('returns zeros for an empty set instead of dividing by zero', () => {
    expect(aggregateMetrics([])).toEqual({
      receiptCount: 0,
      dateMatchRate: 0,
      storeMatchRate: 0,
      totalWithin1krRate: 0,
      meanItemRecall: 0,
      meanPriceAccuracy: 0,
      meanAbsLineCountDiff: 0,
    });
  });
});
