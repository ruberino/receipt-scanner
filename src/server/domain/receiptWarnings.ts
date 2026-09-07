import { and, eq, isNull } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { receiptLines } from '../db/schema.ts';

/** Kinds that count toward the receipt's line sum for TOTAL_MISMATCH; 'other' lines are excluded. */
const LINE_SUM_KINDS: readonly string[] = ['item', 'discount', 'deposit'];

export const TOTAL_MATCH_TOLERANCE_ORE = 100;

/** Sum of item/discount/deposit line totals for the total-mismatch check. */
export function computeLineSum(db: AppDatabase, receiptId: number): number {
  return db
    .select({ kind: receiptLines.kind, totalOre: receiptLines.totalOre })
    .from(receiptLines)
    .where(eq(receiptLines.receiptId, receiptId))
    .all()
    .filter((line) => LINE_SUM_KINDS.includes(line.kind))
    .reduce((sum, line) => sum + line.totalOre, 0);
}

/** Whether any item line on the receipt still has no product, for the UNMATCHED_LINES check. */
export function hasUnmatchedItemLine(db: AppDatabase, receiptId: number): boolean {
  const row = db
    .select({ id: receiptLines.id })
    .from(receiptLines)
    .where(
      and(
        eq(receiptLines.receiptId, receiptId),
        eq(receiptLines.kind, 'item'),
        isNull(receiptLines.productId),
      ),
    )
    .get();
  return row !== undefined;
}
