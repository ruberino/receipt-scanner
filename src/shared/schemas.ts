import { z } from 'zod';
import { isIsoDate } from './dates.ts';
import { PRODUCT_CATEGORIES } from './categories.ts';

export const productCategorySchema = z.enum(PRODUCT_CATEGORIES);

export const loginSchema = z
  .object({
    password: z.string().min(1).max(200),
  })
  .strict();

export type LoginRequest = z.infer<typeof loginSchema>;

export const receiptStatusSchema = z.enum(['uploaded', 'pending', 'processing', 'done', 'failed']);
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;

export const receiptSummarySchema = z.object({
  id: z.number().int(),
  status: receiptStatusSchema,
  storeName: z.string().nullable(),
  purchasedAt: z.string().nullable(),
  totalOre: z.number().int().nullable(),
  lineCount: z.number().int(),
  warnings: z.array(z.string()),
  errorMessage: z.string().nullable(),
  possibleDuplicateOf: z.number().int().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ReceiptSummary = z.infer<typeof receiptSummarySchema>;

export const lineKindSchema = z.enum(['item', 'discount', 'deposit', 'other']);
export type LineKind = z.infer<typeof lineKindSchema>;
const lineUnitSchema = z.enum(['stk', 'kg', 'l']).nullable();
const matchSourceSchema = z.enum(['alias', 'llm', 'user']).nullable();

export const receiptLineProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  category: z.string().nullable(),
});

export const receiptLineSchema = z.object({
  id: z.number().int(),
  lineNo: z.number().int(),
  kind: lineKindSchema,
  rawText: z.string(),
  quantity: z.number(),
  unit: lineUnitSchema,
  unitPriceOre: z.number().int().nullable(),
  totalOre: z.number().int(),
  product: receiptLineProductSchema.nullable(),
  matchSource: matchSourceSchema,
});

export type ReceiptLine = z.infer<typeof receiptLineSchema>;

export const receiptDetailSchema = receiptSummarySchema.extend({
  imageUrl: z.string(),
  lines: z.array(receiptLineSchema),
});

export type ReceiptDetail = z.infer<typeof receiptDetailSchema>;

export const patchReceiptSchema = z
  .object({
    storeName: z.string().trim().min(1).max(80).nullable(),
    purchasedAt: z.string().refine(isIsoDate, 'Ugyldig dato'),
    totalOre: z.number().int().nonnegative(),
    reviewed: z.boolean(),
  })
  .partial()
  .strict();

export type PatchReceiptRequest = z.infer<typeof patchReceiptSchema>;

export const patchReceiptLineFieldsSchema = z
  .object({
    totalOre: z.number().int(),
    quantity: z.number().positive(),
    unitPriceOre: z.number().int().nullable(),
    kind: lineKindSchema,
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Minst ett felt må endres');

export type PatchReceiptLineFieldsRequest = z.infer<typeof patchReceiptLineFieldsSchema>;

export const patchReceiptLineSchema = z.union([
  z.object({ productId: z.number().int().positive() }).strict(),
  z
    .object({
      newProductName: z.string().trim().min(1).max(120),
      category: productCategorySchema.optional(),
    })
    .strict(),
  patchReceiptLineFieldsSchema,
]);

export type PatchReceiptLineRequest = z.infer<typeof patchReceiptLineSchema>;

const productAliasSourceSchema = z.enum(['llm', 'user']);

export const productSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  category: z.string().nullable(),
  suppressed: z.boolean(),
  timesBought: z.number().int(),
  lastBought: z.string().nullable(),
  medianIntervalDays: z.number().nullable(),
});

export type Product = z.infer<typeof productSchema>;

export const productDetailSchema = productSchema.extend({
  aliases: z.array(
    z.object({
      id: z.number().int(),
      alias: z.string(),
      source: productAliasSourceSchema,
    }),
  ),
  purchases: z.array(
    z.object({
      receiptId: z.number().int(),
      date: z.string(),
      storeName: z.string().nullable(),
      quantity: z.number(),
      unit: lineUnitSchema,
      totalOre: z.number().int(),
    }),
  ),
});

export type ProductDetail = z.infer<typeof productDetailSchema>;

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: productCategorySchema.optional(),
  })
  .strict();

export type CreateProductRequest = z.infer<typeof createProductSchema>;

export const patchProductSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: productCategorySchema,
    suppressed: z.boolean(),
  })
  .partial()
  .strict();

export type PatchProductRequest = z.infer<typeof patchProductSchema>;

export const mergeProductSchema = z
  .object({
    intoProductId: z.number().int().positive(),
  })
  .strict();

export type MergeProductRequest = z.infer<typeof mergeProductSchema>;

const shoppingListStatusSchema = z.enum(['open', 'done']);
const shoppingListItemSourceSchema = z.enum(['suggested', 'manual']);

export const shoppingListItemSchema = z.object({
  id: z.number().int(),
  productId: z.number().int().nullable(),
  name: z.string(),
  quantityText: z.string().nullable(),
  source: shoppingListItemSourceSchema,
  reason: z.string().nullable(),
  checked: z.boolean(),
  position: z.number().int(),
  category: z.string().nullable(),
});

export type ShoppingListItem = z.infer<typeof shoppingListItemSchema>;

export const shoppingListSchema = z.object({
  id: z.number().int(),
  weekStart: z.string(),
  status: shoppingListStatusSchema,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  items: z.array(shoppingListItemSchema),
});

export type ShoppingList = z.infer<typeof shoppingListSchema>;

/** `ShoppingList` without `items`, plus `itemCount` — the same relationship `ReceiptSummary` has
 * to `ReceiptDetail` — for the history list (`GET /api/shopping-lists`), T23. */
export const shoppingListSummarySchema = z.object({
  id: z.number().int(),
  weekStart: z.string(),
  status: shoppingListStatusSchema,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  itemCount: z.number().int(),
});

export type ShoppingListSummary = z.infer<typeof shoppingListSummarySchema>;

export const createShoppingListItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    productId: z.number().int().positive().optional(),
    quantityText: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

export type CreateShoppingListItemRequest = z.infer<typeof createShoppingListItemSchema>;

export const patchShoppingListItemSchema = z
  .object({
    checked: z.boolean(),
    name: z.string().trim().min(1).max(120),
    quantityText: z.string().trim().min(1).max(60).nullable(),
    position: z.number().int().positive(),
  })
  .partial()
  .strict();

export type PatchShoppingListItemRequest = z.infer<typeof patchShoppingListItemSchema>;

export const suggestionSchema = z.object({
  productId: z.number().int(),
  name: z.string(),
  category: z.string().nullable(),
  reason: z.string(),
  quantityText: z.string(),
  score: z.number(),
});

export type Suggestion = z.infer<typeof suggestionSchema>;

/** One calendar month's `done`-receipt totals (T23); `month` is `YYYY-MM`. */
export const monthlyStatsSchema = z.object({
  month: z.string(),
  totalOre: z.number().int(),
  receipts: z.number().int(),
});

export type MonthlyStats = z.infer<typeof monthlyStatsSchema>;

export const statsSummarySchema = z.object({
  months: z.array(monthlyStatsSchema),
  topProducts: z.array(productSchema),
});

export type StatsSummary = z.infer<typeof statsSummarySchema>;
