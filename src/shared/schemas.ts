import { z } from 'zod';

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
