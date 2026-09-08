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
  /** The list this receipt was bought for, or null (T39, ADR-0018). */
  shoppingListId: z.number().int().nullable(),
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
  /** The linked list's id and week, or null (T39, ADR-0018); the receipt page shows a link. */
  shoppingList: z.object({ id: z.number().int(), weekStart: z.string() }).nullable(),
});

export type ReceiptDetail = z.infer<typeof receiptDetailSchema>;

export const patchReceiptSchema = z
  .object({
    storeName: z.string().trim().min(1).max(80).nullable(),
    purchasedAt: z.string().refine(isIsoDate, 'Ugyldig dato'),
    totalOre: z.number().int().nonnegative(),
    reviewed: z.boolean(),
    /** Links or unlinks the receipt by hand; `null` unlinks (T39, ADR-0018). */
    shoppingListId: z.number().int().positive().nullable(),
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

const productStatsSchema = z.object({
  timesBought: z.number().int(),
  lastBought: z.string().nullable(),
  medianIntervalDays: z.number().nullable(),
});

export const productSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  category: z.string().nullable(),
  suppressed: z.boolean(),
  timesBought: z.number().int(),
  lastBought: z.string().nullable(),
  medianIntervalDays: z.number().nullable(),
  /** The group this product is a variant of, or null (T40, ADR-0019). */
  parentId: z.number().int().nullable(),
  /** Number of variants, 0 for anything that is not a group (T40, ADR-0019). */
  variantCount: z.number().int(),
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
  /** The group this product is a variant of, with its name for display (T40, ADR-0019). */
  parent: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  /** This product's variants, each with its own stats (T40, ADR-0019); empty when not a group. */
  variants: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      timesBought: z.number().int(),
      lastBought: z.string().nullable(),
    }),
  ),
  /** The group's folded stats, only set for a parent (T40, ADR-0019). */
  groupStats: productStatsSchema.nullable(),
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

export const attachProductParentSchema = z
  .object({
    parentId: z.number().int().positive(),
  })
  .strict();

export type AttachProductParentRequest = z.infer<typeof attachProductParentSchema>;

export const createProductGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: productCategorySchema.optional(),
    memberIds: z.array(z.number().int().positive()).min(1),
  })
  .strict();

export type CreateProductGroupRequest = z.infer<typeof createProductGroupSchema>;

export const groupCandidateSchema = z.object({
  suggestedName: z.string(),
  productIds: z.array(z.number().int()),
});

export type GroupCandidate = z.infer<typeof groupCandidateSchema>;

const shoppingListStatusSchema = z.enum(['open', 'done']);
const shoppingListItemSourceSchema = z.enum(['suggested', 'manual', 'ai']);

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

const tripCountsSchema = z.object({
  planned: z.number().int(),
  bought: z.number().int(),
  notBought: z.number().int(),
  unplanned: z.number().int(),
});

/** What was bought against what was planned, computed on read from the list's items and its
 * linked receipts' lines; never stored (T39, ADR-0018). */
export const tripSchema = z.object({
  planned: z.array(
    z.object({
      itemId: z.number().int(),
      name: z.string(),
      quantityText: z.string().nullable(),
      source: shoppingListItemSourceSchema,
      checked: z.boolean(),
      status: z.enum(['bought', 'notBought']),
    }),
  ),
  unplanned: z.array(
    z.object({
      productId: z.number().int().nullable(),
      name: z.string(),
      quantity: z.number(),
      unit: z.string().nullable(),
    }),
  ),
  counts: tripCountsSchema,
  receiptIds: z.array(z.number().int()),
});

export type Trip = z.infer<typeof tripSchema>;

export const shoppingListSchema = z.object({
  id: z.number().int(),
  weekStart: z.string(),
  status: shoppingListStatusSchema,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  items: z.array(shoppingListItemSchema),
  /** Linked receipts, newest first (T39, ADR-0018). */
  receipts: z.array(receiptSummarySchema),
  /** `null` while the list is `open` or has no linked receipt (T39, ADR-0018). */
  trip: tripSchema.nullable(),
});

export type ShoppingList = z.infer<typeof shoppingListSchema>;

/** `ShoppingList` without `items` or `receipts`, plus `itemCount` — the same relationship
 * `ReceiptSummary` has to `ReceiptDetail` — for the history list (`GET /api/shopping-lists`), T23.
 * `tripCounts` is `null` on the same terms as `trip` (T39). */
export const shoppingListSummarySchema = z.object({
  id: z.number().int(),
  weekStart: z.string(),
  status: shoppingListStatusSchema,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  itemCount: z.number().int(),
  tripCounts: tripCountsSchema.nullable(),
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

const proposalItemKindSchema = z.enum(['sesong', 'merkedag', 'variasjon', 'vane']);

/** One item in an AI proposal (T37, ADR-0016); `index` is its position in the proposal's own
 * `items` array, which `POST .../accept`'s `indexes` refers back to. */
export const shoppingListProposalItemSchema = z.object({
  index: z.number().int(),
  productId: z.number().int().nullable(),
  name: z.string(),
  category: z.string().nullable(),
  quantityText: z.string().nullable(),
  reason: z.string(),
  kind: proposalItemKindSchema,
});

export type ShoppingListProposalItem = z.infer<typeof shoppingListProposalItemSchema>;

export const shoppingListProposalSchema = z.object({
  id: z.number().int(),
  createdAt: z.string(),
  model: z.string(),
  items: z.array(shoppingListProposalItemSchema),
});

export type ShoppingListProposal = z.infer<typeof shoppingListProposalSchema>;

export const acceptProposalSchema = z
  .object({
    indexes: z.array(z.number().int()),
  })
  .strict();

export type AcceptProposalRequest = z.infer<typeof acceptProposalSchema>;

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

/** All-time counts over `shopping_list_proposals`, the acceptance-rate inputs (T37, ADR-0016);
 * `boughtItems` is the subset of accepted items whose list item is `bought` in its trip (T39). */
export const aiProposalsStatsSchema = z.object({
  proposals: z.number().int(),
  proposedItems: z.number().int(),
  acceptedItems: z.number().int(),
  boughtItems: z.number().int(),
});

export type AiProposalsStats = z.infer<typeof aiProposalsStatsSchema>;

/** All-time counts over every `done` list's trip (T39, ADR-0018). */
export const tripsStatsSchema = z.object({
  completedLists: z.number().int(),
  listsWithReceipt: z.number().int(),
  plannedItems: z.number().int(),
  boughtItems: z.number().int(),
  unplannedItems: z.number().int(),
});

export type TripsStats = z.infer<typeof tripsStatsSchema>;

export const statsSummarySchema = z.object({
  months: z.array(monthlyStatsSchema),
  topProducts: z.array(productSchema),
  aiProposals: aiProposalsStatsSchema,
  trips: tripsStatsSchema,
});

export type StatsSummary = z.infer<typeof statsSummarySchema>;
