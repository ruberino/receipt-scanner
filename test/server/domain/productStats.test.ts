import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type OpenedDatabase } from '../../../src/server/db/client.ts';
import { runMigrations } from '../../../src/server/db/migrate.ts';
import { products, receiptLines, receipts } from '../../../src/server/db/schema.ts';
import {
  computeProductStats,
  loadProductHistories,
  loadProductHistoriesUnfolded,
  loadProductStats,
  loadProductStatsMap,
} from '../../../src/server/domain/productStats.ts';

const NOW = '2026-09-03T12:00:00.000Z';

let opened: OpenedDatabase;

function createDb(): OpenedDatabase {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function insertReceipt(
  purchasedAt: string,
  overrides: Partial<typeof receipts.$inferInsert> = {},
): number {
  return opened.db
    .insert(receipts)
    .values({
      status: 'done',
      purchasedAt,
      totalOre: 100,
      warningsJson: '[]',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertProduct(
  name: string,
  overrides: Partial<typeof products.$inferInsert> = {},
): number {
  return opened.db
    .insert(products)
    .values({
      name,
      nameNormalized: name.toUpperCase(),
      category: 'Meieri',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertLine(
  receiptId: number,
  lineNo: number,
  productId: number | null,
  overrides: Partial<typeof receiptLines.$inferInsert> = {},
): number {
  return opened.db
    .insert(receiptLines)
    .values({
      receiptId,
      lineNo,
      kind: 'item',
      rawText: 'line',
      totalOre: 100,
      productId,
      createdAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

afterEach(() => {
  opened?.sqlite.close();
});

describe('computeProductStats', () => {
  it('returns zeros and nulls for no purchases', () => {
    expect(computeProductStats([])).toEqual({
      timesBought: 0,
      lastBought: null,
      medianIntervalDays: null,
    });
  });

  it('returns null medianIntervalDays for a single purchase', () => {
    expect(computeProductStats(['2026-08-01'])).toEqual({
      timesBought: 1,
      lastBought: '2026-08-01',
      medianIntervalDays: null,
    });
  });

  it('counts duplicate dates once', () => {
    const stats = computeProductStats(['2026-08-01', '2026-08-01', '2026-08-08']);
    expect(stats.timesBought).toBe(2);
    expect(stats.medianIntervalDays).toBe(7);
  });

  it('takes the median of the gaps between consecutive distinct dates (even count)', () => {
    // gaps: 7 (08-01 -> 08-08), 14 (08-08 -> 08-22) -> median 10.5
    const stats = computeProductStats(['2026-08-01', '2026-08-08', '2026-08-22']);
    expect(stats.timesBought).toBe(3);
    expect(stats.lastBought).toBe('2026-08-22');
    expect(stats.medianIntervalDays).toBe(10.5);
  });

  it('takes the median of the gaps between consecutive distinct dates (odd count)', () => {
    // gaps: 7, 7, 21 -> median 7
    const stats = computeProductStats(['2026-08-01', '2026-08-08', '2026-08-15', '2026-09-05']);
    expect(stats.medianIntervalDays).toBe(7);
  });

  it('sorts unordered input before computing gaps', () => {
    const stats = computeProductStats(['2026-08-22', '2026-08-01', '2026-08-08']);
    expect(stats.lastBought).toBe('2026-08-22');
    expect(stats.medianIntervalDays).toBe(10.5);
  });
});

describe('loadProductStats / loadProductStatsMap', () => {
  it('matches a hand-computed fixture: three receipts, two products', () => {
    opened = createDb();
    const productA = insertProduct('Lettmelk 1 l');
    const productB = insertProduct('Havregryn 1 kg');

    const r1 = insertReceipt('2026-08-01');
    insertLine(r1, 1, productA);
    insertLine(r1, 2, productB);

    const r2 = insertReceipt('2026-08-08');
    insertLine(r2, 1, productA);

    const r3 = insertReceipt('2026-08-22');
    insertLine(r3, 1, productA);

    const map = loadProductStatsMap(opened.db);
    expect(map.get(productA)).toEqual({
      timesBought: 3,
      lastBought: '2026-08-22',
      medianIntervalDays: 10.5,
    });
    expect(map.get(productB)).toEqual({
      timesBought: 1,
      lastBought: '2026-08-01',
      medianIntervalDays: null,
    });

    expect(loadProductStats(opened.db, productA)).toEqual(map.get(productA));
    expect(loadProductStats(opened.db, productB)).toEqual(map.get(productB));
  });

  it('ignores lines on receipts that are not done', () => {
    opened = createDb();
    const productId = insertProduct('Lettmelk 1 l');
    const pending = insertReceipt('2026-08-01', { status: 'pending' });
    insertLine(pending, 1, productId);

    expect(loadProductStats(opened.db, productId)).toEqual({
      timesBought: 0,
      lastBought: null,
      medianIntervalDays: null,
    });
    expect(loadProductStatsMap(opened.db).has(productId)).toBe(false);
  });

  it('ignores non-item lines such as discounts', () => {
    opened = createDb();
    const productId = insertProduct('Lettmelk 1 l');
    const r1 = insertReceipt('2026-08-01');
    insertLine(r1, 1, productId, { kind: 'discount' });

    expect(loadProductStats(opened.db, productId)).toEqual({
      timesBought: 0,
      lastBought: null,
      medianIntervalDays: null,
    });
  });

  it('returns zeros for a product with no purchases', () => {
    opened = createDb();
    const productId = insertProduct('Lettmelk 1 l');

    expect(loadProductStats(opened.db, productId)).toEqual({
      timesBought: 0,
      lastBought: null,
      medianIntervalDays: null,
    });
  });
});

describe('loadProductHistories', () => {
  it('aggregates quantities per receipt date, from done item lines only', () => {
    opened = createDb();
    const productId = insertProduct('Lettmelk 1 l', { category: 'Meieri' });
    const r1 = insertReceipt('2026-08-01');
    insertLine(r1, 1, productId, { quantity: 1, unit: 'stk' });
    insertLine(r1, 2, productId, { quantity: 2, unit: 'stk' });
    const r2 = insertReceipt('2026-08-08');
    insertLine(r2, 1, productId, { quantity: 1, unit: 'stk' });

    const histories = loadProductHistories(opened.db);
    expect(histories).toHaveLength(1);
    const history = histories[0]!;
    expect(history).toMatchObject({
      productId,
      name: 'Lettmelk 1 l',
      category: 'Meieri',
      suppressed: false,
    });
    expect(history.purchases).toEqual(
      expect.arrayContaining([
        { date: '2026-08-01', quantity: 3, unit: 'stk' },
        { date: '2026-08-08', quantity: 1, unit: 'stk' },
      ]),
    );
    expect(history.purchases).toHaveLength(2);
  });

  it('includes suppressed products, leaving the skip decision to the suggestion engine', () => {
    opened = createDb();
    const productId = insertProduct('Suppressed product', { suppressed: 1 });
    const r1 = insertReceipt('2026-08-01');
    insertLine(r1, 1, productId);

    const histories = loadProductHistories(opened.db);
    expect(histories).toHaveLength(1);
    expect(histories[0]!.suppressed).toBe(true);
  });

  it('excludes products with no done-receipt item lines', () => {
    opened = createDb();
    insertProduct('Never bought');

    expect(loadProductHistories(opened.db)).toEqual([]);
  });

  it("folds a variant's purchases into its parent's row (T40)", () => {
    opened = createDb();
    const parentId = insertProduct('Skyr mini');
    const childId = insertProduct('Skyr mini jordbær', { parentId });
    const r1 = insertReceipt('2026-08-01');
    insertLine(r1, 1, childId, { quantity: 2, unit: 'stk' });

    const histories = loadProductHistories(opened.db);

    expect(histories).toHaveLength(1);
    expect(histories[0]).toMatchObject({
      productId: parentId,
      name: 'Skyr mini',
      variants: ['Skyr mini jordbær'],
    });
    expect(histories[0]!.purchases).toEqual([{ date: '2026-08-01', quantity: 2, unit: 'stk' }]);
  });

  it("loadProductHistoriesUnfolded keeps a variant's purchases on its own row (T40)", () => {
    opened = createDb();
    const parentId = insertProduct('Skyr mini');
    const childId = insertProduct('Skyr mini jordbær', { parentId });
    const r1 = insertReceipt('2026-08-01');
    insertLine(r1, 1, childId, { quantity: 2, unit: 'stk' });

    const histories = loadProductHistoriesUnfolded(opened.db);

    expect(histories).toHaveLength(1);
    expect(histories[0]).toMatchObject({ productId: childId, name: 'Skyr mini jordbær' });
  });
});
