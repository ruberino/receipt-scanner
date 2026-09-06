import { and, eq, ne } from 'drizzle-orm';
import { diffDays } from '../../shared/dates.ts';
import type { AppDatabase } from '../db/client.ts';
import { receipts } from '../db/schema.ts';
import { ExtractionError } from '../lib/errors.ts';
import { normalizeText } from '../lib/normalize.ts';
import type { ExtractionResult } from '../llm/extractReceipt.ts';

export type ExtractionWarning =
  | 'TOTAL_MISMATCH'
  | 'MISSING_DATE'
  | 'MISSING_STORE'
  | 'FUTURE_DATE'
  | 'UNMATCHED_LINES'
  | 'MATCHING_FAILED'
  | 'POSSIBLE_DUPLICATE';

export type AppliedLine = {
  lineNo: number;
  kind: 'item' | 'discount' | 'deposit' | 'other';
  rawText: string;
  quantity: number;
  unit: 'stk' | 'kg' | 'l' | null;
  unitPriceOre: number | null;
  totalOre: number;
};

export type AppliedExtraction = {
  storeName: string | null;
  purchasedAt: string;
  totalOre: number;
  warnings: ExtractionWarning[];
  lines: AppliedLine[];
};

const LINE_SUM_KINDS = new Set<AppliedLine['kind']>(['item', 'discount', 'deposit']);

/** Converts a validated extraction result into receipt fields, øre-integer lines and warnings (architecture.md 7.4). */
export function applyExtraction(result: ExtractionResult, scanDate: string): AppliedExtraction {
  const warnings: ExtractionWarning[] = [];

  let purchasedAt = result.purchasedAt;
  if (!purchasedAt) {
    purchasedAt = scanDate;
    warnings.push('MISSING_DATE');
  } else if (diffDays(scanDate, purchasedAt) > 0) {
    warnings.push('FUTURE_DATE');
  }

  if (!result.storeName) {
    warnings.push('MISSING_STORE');
  }

  const lines: AppliedLine[] = result.lines.map((line, index) => ({
    lineNo: index + 1,
    kind: line.kind,
    rawText: line.text,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceOre: line.unitPrice === null ? null : Math.round(line.unitPrice * 100),
    totalOre: Math.round(line.totalPrice * 100),
  }));

  if (!lines.some((line) => line.kind === 'item')) {
    throw new ExtractionError('Fant ingen varelinjer', 'extraction');
  }

  const lineSum = lines
    .filter((line) => LINE_SUM_KINDS.has(line.kind))
    .reduce((sum, line) => sum + line.totalOre, 0);

  let totalOre: number;
  if (result.total === null) {
    totalOre = lineSum;
    warnings.push('TOTAL_MISMATCH');
  } else {
    totalOre = Math.round(result.total * 100);
    if (Math.abs(lineSum - totalOre) > 100) {
      warnings.push('TOTAL_MISMATCH');
    }
  }

  return { storeName: result.storeName, purchasedAt, totalOre, warnings, lines };
}

/**
 * Looks for another `done` receipt with the same purchased_at, total_ore and normalizeText(store_name)
 * (two null stores count as equal); returns its id, or null (architecture.md 7.4).
 */
export function findPossibleDuplicate(
  db: AppDatabase,
  receiptId: number,
  storeName: string | null,
  purchasedAt: string,
  totalOre: number,
): number | null {
  const normalizedStore = storeName === null ? null : normalizeText(storeName);

  const candidates = db
    .select({ id: receipts.id, storeName: receipts.storeName })
    .from(receipts)
    .where(
      and(
        eq(receipts.status, 'done'),
        eq(receipts.purchasedAt, purchasedAt),
        eq(receipts.totalOre, totalOre),
        ne(receipts.id, receiptId),
      ),
    )
    .all();

  const match = candidates.find((candidate) => {
    const candidateNormalized =
      candidate.storeName === null ? null : normalizeText(candidate.storeName);
    return candidateNormalized === normalizedStore;
  });

  return match ? match.id : null;
}
