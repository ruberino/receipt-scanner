import { describe, expect, it } from 'vitest';
import {
  findGroupCandidates,
  foldHistories,
  type GroupCandidateProduct,
  type ProductGroupParent,
} from '../../../src/server/domain/productGroups.ts';
import { computeSuggestions } from '../../../src/server/domain/suggestions.ts';
import type { ProductHistory, ProductPurchase } from '../../../src/server/domain/productStats.ts';

function history(overrides: Partial<ProductHistory> = {}): ProductHistory {
  return {
    productId: 1,
    name: 'Product',
    category: null,
    suppressed: false,
    purchases: [],
    variants: [],
    ...overrides,
  };
}

function purchase(date: string, quantity = 1, unit: ProductPurchase['unit'] = 'stk') {
  return { date, quantity, unit };
}

describe('foldHistories', () => {
  const parent: ProductGroupParent = {
    id: 1,
    name: 'Skyr mini',
    category: 'Meieri',
    suppressed: false,
  };

  it('folds two children into a parent with summed quantities on a shared date and the union of dates', () => {
    const jordbaer = history({
      productId: 2,
      name: 'Skyr mini jordbær',
      category: 'Meieri',
      purchases: [purchase('2026-09-01', 2), purchase('2026-09-08', 1)],
    });
    const banan = history({
      productId: 3,
      name: 'Skyr mini banan',
      category: 'Meieri',
      purchases: [purchase('2026-09-01', 1)],
    });
    const parentOf = new Map([
      [2, 1],
      [3, 1],
    ]);

    const folded = foldHistories([jordbaer, banan], parentOf, [parent]);

    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({
      productId: 1,
      name: 'Skyr mini',
      suppressed: false,
      variants: ['Skyr mini banan', 'Skyr mini jordbær'],
    });
    expect(folded[0]!.purchases.sort((a, b) => a.date.localeCompare(b.date))).toEqual([
      { date: '2026-09-01', quantity: 3, unit: 'stk' },
      { date: '2026-09-08', quantity: 1, unit: 'stk' },
    ]);
  });

  it("merges a parent's own purchases with its children's", () => {
    const ownHistory = history({
      productId: 1,
      name: 'Skyr mini',
      category: 'Meieri',
      purchases: [purchase('2026-09-15', 1)],
    });
    const jordbaer = history({
      productId: 2,
      name: 'Skyr mini jordbær',
      purchases: [purchase('2026-09-01', 2)],
    });
    const parentOf = new Map([[2, 1]]);

    const folded = foldHistories([ownHistory, jordbaer], parentOf, [parent]);

    expect(folded).toHaveLength(1);
    expect(folded[0]!.purchases.sort((a, b) => a.date.localeCompare(b.date))).toEqual([
      { date: '2026-09-01', quantity: 2, unit: 'stk' },
      { date: '2026-09-15', quantity: 1, unit: 'stk' },
    ]);
  });

  it('leaves a suppressed child out of the fold entirely', () => {
    const jordbaer = history({
      productId: 2,
      name: 'Skyr mini jordbær',
      purchases: [purchase('2026-09-01', 2)],
    });
    const banan = history({
      productId: 3,
      name: 'Skyr mini banan',
      suppressed: true,
      purchases: [purchase('2026-09-01', 5)],
    });
    const parentOf = new Map([
      [2, 1],
      [3, 1],
    ]);

    const folded = foldHistories([jordbaer, banan], parentOf, [parent]);

    expect(folded).toHaveLength(1);
    expect(folded[0]!.variants).toEqual(['Skyr mini jordbær']);
    expect(folded[0]!.purchases).toEqual([{ date: '2026-09-01', quantity: 2, unit: 'stk' }]);
  });

  it('keeps a suppressed parent suppressed so the engine still skips the whole group', () => {
    const suppressedParent: ProductGroupParent = { ...parent, suppressed: true };
    const jordbaer = history({
      productId: 2,
      name: 'Skyr mini jordbær',
      purchases: [purchase('2026-08-10', 2), purchase('2026-08-17', 2)],
    });
    const parentOf = new Map([[2, 1]]);

    const folded = foldHistories([jordbaer], parentOf, [suppressedParent]);

    expect(folded).toHaveLength(1);
    expect(folded[0]!.suppressed).toBe(true);
    expect(computeSuggestions(folded, '2026-08-24')).toEqual([]);
  });

  it('leaves an ungrouped product unchanged with variants: []', () => {
    const ungrouped = history({ productId: 9, name: 'Banan', purchases: [purchase('2026-09-01')] });

    const folded = foldHistories([ungrouped], new Map(), []);

    expect(folded).toEqual([{ ...ungrouped, variants: [] }]);
  });

  it('the folded weekly quantity text is the median of weekly sums across variants (through computeSuggestions)', () => {
    const jordbaer = history({
      productId: 2,
      name: 'Skyr mini jordbær',
      purchases: [purchase('2026-08-10', 2), purchase('2026-08-24', 4)],
    });
    const banan = history({
      productId: 3,
      name: 'Skyr mini banan',
      purchases: [purchase('2026-08-17', 3), purchase('2026-08-31', 1)],
    });
    const parentOf = new Map([
      [2, 1],
      [3, 1],
    ]);

    const folded = foldHistories([jordbaer, banan], parentOf, [parent]);
    const suggestions = computeSuggestions(folded, '2026-09-07');

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      productId: 1,
      name: 'Skyr mini',
      quantityText: '3 stk',
    });
  });
});

describe('findGroupCandidates', () => {
  function product(overrides: Partial<GroupCandidateProduct>): GroupCandidateProduct {
    return {
      id: 1,
      name: 'Product',
      category: 'Meieri',
      parentId: null,
      suppressed: false,
      ...overrides,
    };
  }

  it('forms a candidate from two flavours sharing a category and a two-token prefix', () => {
    const candidates = findGroupCandidates([
      product({ id: 1, name: 'Skyr mini jordbær' }),
      product({ id: 2, name: 'Skyr mini banan' }),
    ]);

    expect(candidates).toEqual([{ suggestedName: 'Skyr mini', productIds: [1, 2] }]);
  });

  it('never forms a candidate from a two-token name on its own', () => {
    const candidates = findGroupCandidates([
      product({ id: 1, name: 'Skyr mini' }),
      product({ id: 2, name: 'Skyr solo' }),
    ]);

    expect(candidates).toEqual([]);
  });

  it('does not group two products with the same name prefix but different categories', () => {
    const candidates = findGroupCandidates([
      product({ id: 1, name: 'Skyr mini jordbær', category: 'Meieri' }),
      product({ id: 2, name: 'Skyr mini banan', category: 'Frukt og grønt' }),
    ]);

    expect(candidates).toEqual([]);
  });

  it('skips a product that already has a parent or already has children', () => {
    const candidates = findGroupCandidates([
      product({ id: 1, name: 'Skyr mini jordbær', parentId: 10 }),
      product({ id: 2, name: 'Skyr mini banan' }),
      product({ id: 10, name: 'Skyr mini' }),
    ]);

    expect(candidates).toEqual([]);
  });
});
