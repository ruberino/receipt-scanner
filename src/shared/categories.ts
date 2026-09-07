export const PRODUCT_CATEGORIES = [
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
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** Store-walk order for grouping the shopping list (T32): produce first, then the aisles, frozen
 * and drinks last so cold and frozen items spend the least time out of the fridge/freezer bag. */
export const SHOPPING_CATEGORY_ORDER = [
  'Frukt og grønt',
  'Brød og bakevarer',
  'Meieri',
  'Kjøtt og fisk',
  'Tørrvarer',
  'Frossen',
  'Drikke',
  'Snacks',
  'Husholdning',
  'Hygiene',
  'Annet',
] as const satisfies readonly ProductCategory[];
