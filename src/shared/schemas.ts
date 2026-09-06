import { z } from 'zod';
import { isIsoDate } from './dates.ts';
import { productCategorySchema } from './categories.ts';

export const loginSchema = z
  .object({
    password: z.string().min(1).max(200),
  })
  .strict();

export type LoginRequest = z.infer<typeof loginSchema>;

export const receiptStatusSchema = z.enum(['pending', 'processing', 'done', 'failed']);
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
});

export type ReceiptSummary = z.infer<typeof receiptSummarySchema>;

const lineKindSchema = z.enum(['item', 'discount', 'deposit', 'other']);
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

export const patchReceiptLineSchema = z.union([
  z.object({ productId: z.number().int().positive() }).strict(),
  z
    .object({
      newProductName: z.string().trim().min(1).max(120),
      category: productCategorySchema.optional(),
    })
    .strict(),
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
