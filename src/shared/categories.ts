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
