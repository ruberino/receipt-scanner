import { describe, expect, it } from 'vitest';
import { PRODUCT_CATEGORIES, SHOPPING_CATEGORY_ORDER } from '../../src/shared/categories.ts';
import { productCategorySchema } from '../../src/shared/schemas.ts';

describe('PRODUCT_CATEGORIES', () => {
  it('is exactly the fixed list from architecture.md section 6', () => {
    expect(PRODUCT_CATEGORIES).toEqual([
      'Frukt og grønt',
      'Meieri',
      'Kjøtt og fisk',
      'Brød og bakevarer',
      'Tørrvarer',
      'Frossen',
      'Drikke',
      'Snacks',
      'Husholdning',
      'Hygiene',
      'Annet',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(PRODUCT_CATEGORIES).size).toBe(PRODUCT_CATEGORIES.length);
  });
});

describe('SHOPPING_CATEGORY_ORDER (T32)', () => {
  it('is a permutation of PRODUCT_CATEGORIES: same categories, none missing, none repeated', () => {
    expect([...SHOPPING_CATEGORY_ORDER].sort()).toEqual([...PRODUCT_CATEGORIES].sort());
  });
});

describe('productCategorySchema', () => {
  it('accepts every category', () => {
    for (const category of PRODUCT_CATEGORIES) {
      expect(productCategorySchema.parse(category)).toBe(category);
    }
  });

  it('rejects unknown values and case variants', () => {
    expect(productCategorySchema.safeParse('Ukjent').success).toBe(false);
    expect(productCategorySchema.safeParse('meieri').success).toBe(false);
    expect(productCategorySchema.safeParse('').success).toBe(false);
  });
});
