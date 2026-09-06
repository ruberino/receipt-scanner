import { normalizeText } from '../src/shared/normalize.ts';
import type { ExtractionResult } from '../src/server/llm/extractReceipt.ts';

export type ExpectedItem = {
  text: string;
  totalPrice: number;
};

/** Hand-written ground truth for one receipt photo (eval/receipts/<photo>.expected.json). */
export type ExpectedReceipt = {
  storeName: string;
  purchasedAt: string;
  total: number;
  items: ExpectedItem[];
};

export type ReceiptMetrics = {
  dateMatch: boolean;
  storeMatch: boolean;
  totalWithin1kr: boolean;
  itemRecall: number;
  priceAccuracy: number;
  lineCountDiff: number;
};

function toOre(nok: number): number {
  return Math.round(nok * 100);
}

export function dateMatch(expected: ExpectedReceipt, result: ExtractionResult): boolean {
  return result.purchasedAt !== null && result.purchasedAt === expected.purchasedAt;
}

/** The normalized expected store name is contained in the normalized extracted one. */
export function storeMatch(expected: ExpectedReceipt, result: ExtractionResult): boolean {
  if (result.storeName === null) {
    return false;
  }
  return normalizeText(result.storeName).includes(normalizeText(expected.storeName));
}

export function totalWithin1kr(expected: ExpectedReceipt, result: ExtractionResult): boolean {
  if (result.total === null) {
    return false;
  }
  return Math.abs(result.total - expected.total) <= 1;
}

/**
 * Greedily matches each expected item to an unclaimed extracted line by normalized text equality
 * (any `kind`, not just `item`), so a line the model miscategorised as `other` can still count.
 * Shared by `itemRecall` and `priceAccuracy` so the two stay consistent with each other.
 */
function matchItems(
  expected: ExpectedReceipt,
  result: ExtractionResult,
): { matchedCount: number; priceAccurateCount: number } {
  const remaining = result.lines.map((line) => ({
    key: normalizeText(line.text),
    totalPrice: line.totalPrice,
  }));

  let matchedCount = 0;
  let priceAccurateCount = 0;
  for (const item of expected.items) {
    const key = normalizeText(item.text);
    const index = remaining.findIndex((line) => line.key === key);
    if (index === -1) {
      continue;
    }
    matchedCount += 1;
    const [line] = remaining.splice(index, 1);
    if (toOre(line!.totalPrice) === toOre(item.totalPrice)) {
      priceAccurateCount += 1;
    }
  }
  return { matchedCount, priceAccurateCount };
}

/** Share of expected item texts found by normalized equality; 1 when there are no expected items. */
export function itemRecall(expected: ExpectedReceipt, result: ExtractionResult): number {
  if (expected.items.length === 0) {
    return 1;
  }
  return matchItems(expected, result).matchedCount / expected.items.length;
}

/** Share of matched items with the same øre total; 0 when nothing matched. */
export function priceAccuracy(expected: ExpectedReceipt, result: ExtractionResult): number {
  const { matchedCount, priceAccurateCount } = matchItems(expected, result);
  if (matchedCount === 0) {
    return 0;
  }
  return priceAccurateCount / matchedCount;
}

/** Extracted line count minus expected item count; positive means the model over-extracted. */
export function lineCountDiff(expected: ExpectedReceipt, result: ExtractionResult): number {
  return result.lines.length - expected.items.length;
}

export function computeReceiptMetrics(
  expected: ExpectedReceipt,
  result: ExtractionResult,
): ReceiptMetrics {
  return {
    dateMatch: dateMatch(expected, result),
    storeMatch: storeMatch(expected, result),
    totalWithin1kr: totalWithin1kr(expected, result),
    itemRecall: itemRecall(expected, result),
    priceAccuracy: priceAccuracy(expected, result),
    lineCountDiff: lineCountDiff(expected, result),
  };
}

export type AggregateMetrics = {
  receiptCount: number;
  dateMatchRate: number;
  storeMatchRate: number;
  totalWithin1krRate: number;
  meanItemRecall: number;
  meanPriceAccuracy: number;
  meanAbsLineCountDiff: number;
};

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(values: boolean[]): number {
  return values.length === 0 ? 0 : values.filter(Boolean).length / values.length;
}

export function aggregateMetrics(rows: ReceiptMetrics[]): AggregateMetrics {
  return {
    receiptCount: rows.length,
    dateMatchRate: rate(rows.map((row) => row.dateMatch)),
    storeMatchRate: rate(rows.map((row) => row.storeMatch)),
    totalWithin1krRate: rate(rows.map((row) => row.totalWithin1kr)),
    meanItemRecall: mean(rows.map((row) => row.itemRecall)),
    meanPriceAccuracy: mean(rows.map((row) => row.priceAccuracy)),
    meanAbsLineCountDiff: mean(rows.map((row) => Math.abs(row.lineCountDiff))),
  };
}
