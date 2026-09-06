import { diffDays } from '../../shared/dates.ts';
import { ExtractionError } from '../lib/errors.ts';
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
