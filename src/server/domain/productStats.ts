import { and, eq } from 'drizzle-orm';
import { diffDays } from '../../shared/dates.ts';
import type { AppDatabase } from '../db/client.ts';
import { products, receiptLines, receipts } from '../db/schema.ts';

export type ProductStats = {
  timesBought: number;
  lastBought: string | null;
  medianIntervalDays: number | null;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/** timesBought is the count of distinct purchase dates; medianIntervalDays needs at least two. */
export function computeProductStats(purchaseDates: string[]): ProductStats {
  const distinctDates = [...new Set(purchaseDates)].sort();
  if (distinctDates.length === 0) {
    return { timesBought: 0, lastBought: null, medianIntervalDays: null };
  }

  const gaps: number[] = [];
  for (let i = 1; i < distinctDates.length; i += 1) {
    gaps.push(diffDays(distinctDates[i - 1] as string, distinctDates[i] as string));
  }

  return {
    timesBought: distinctDates.length,
    lastBought: distinctDates[distinctDates.length - 1] as string,
    medianIntervalDays: gaps.length > 0 ? median(gaps) : null,
  };
}

/** One query for every product's purchase dates, for a product list instead of one query each. */
export function loadProductStatsMap(db: AppDatabase): Map<number, ProductStats> {
  const rows = db
    .select({ productId: receiptLines.productId, date: receipts.purchasedAt })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(and(eq(receipts.status, 'done'), eq(receiptLines.kind, 'item')))
    .all();

  const datesByProduct = new Map<number, string[]>();
  for (const row of rows) {
    if (row.productId === null) {
      continue;
    }
    const dates = datesByProduct.get(row.productId) ?? [];
    dates.push(row.date as string);
    datesByProduct.set(row.productId, dates);
  }

  const statsByProduct = new Map<number, ProductStats>();
  for (const [productId, dates] of datesByProduct) {
    statsByProduct.set(productId, computeProductStats(dates));
  }
  return statsByProduct;
}

export function loadProductStats(db: AppDatabase, productId: number): ProductStats {
  const rows = db
    .select({ date: receipts.purchasedAt })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(
      and(
        eq(receiptLines.productId, productId),
        eq(receipts.status, 'done'),
        eq(receiptLines.kind, 'item'),
      ),
    )
    .all();
  return computeProductStats(rows.map((row) => row.date as string));
}

export type ProductPurchase = { date: string; quantity: number; unit: 'stk' | 'kg' | 'l' | null };

export type ProductHistory = {
  productId: number;
  name: string;
  category: string | null;
  suppressed: boolean;
  purchases: ProductPurchase[];
};

/**
 * Purchase history per product, purchases aggregated per receipt date (quantities summed), from
 * `done` receipts' `item` lines only. Used by the suggestion engine (T12); only includes products
 * with at least one such purchase, which is exactly what `computeSuggestions`'s `n < 2` rule needs.
 */
export function loadProductHistories(db: AppDatabase): ProductHistory[] {
  const rows = db
    .select({
      productId: products.id,
      name: products.name,
      category: products.category,
      suppressed: products.suppressed,
      date: receipts.purchasedAt,
      quantity: receiptLines.quantity,
      unit: receiptLines.unit,
    })
    .from(receiptLines)
    .innerJoin(products, eq(products.id, receiptLines.productId))
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(and(eq(receipts.status, 'done'), eq(receiptLines.kind, 'item')))
    .all();

  const byProduct = new Map<
    number,
    {
      name: string;
      category: string | null;
      suppressed: boolean;
      byDate: Map<string, ProductPurchase>;
    }
  >();

  for (const row of rows) {
    let entry = byProduct.get(row.productId);
    if (!entry) {
      entry = {
        name: row.name,
        category: row.category,
        suppressed: row.suppressed === 1,
        byDate: new Map(),
      };
      byProduct.set(row.productId, entry);
    }
    const date = row.date as string;
    const existing = entry.byDate.get(date);
    if (existing) {
      existing.quantity += row.quantity;
    } else {
      entry.byDate.set(date, {
        date,
        quantity: row.quantity,
        unit: row.unit as ProductPurchase['unit'],
      });
    }
  }

  return [...byProduct.entries()].map(([productId, entry]) => ({
    productId,
    name: entry.name,
    category: entry.category,
    suppressed: entry.suppressed,
    purchases: [...entry.byDate.values()],
  }));
}
