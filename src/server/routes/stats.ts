import type { FastifyInstance } from 'fastify';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { todayInOslo } from '../../shared/dates.ts';
import { products, receipts } from '../db/schema.ts';
import { loadProductStatsMap, type ProductStats } from '../domain/productStats.ts';
import { toProduct } from './products.ts';

const NO_STATS: ProductStats = { timesBought: 0, lastBought: null, medianIntervalDays: null };
const TOP_PRODUCTS_LIMIT = 10;

const summaryQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});

function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** `count` calendar months as `YYYY-MM`, ascending, the last one being `endMonth` itself. */
function monthsWindow(endMonth: string, count: number): string[] {
  const [endYear, endMonthNumber] = endMonth.split('-').map(Number) as [number, number];
  const endIndex = endYear * 12 + (endMonthNumber - 1);

  const months: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const index = endIndex - offset;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    months.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return months;
}

export type StatsRouteOptions = {
  /** Same clock the other routes get, so the month window is deterministic in tests. */
  now: () => Date;
};

export default async function statsRoutes(
  app: FastifyInstance,
  options: StatsRouteOptions,
): Promise<void> {
  app.get('/api/stats/summary', async (request) => {
    const query = summaryQuerySchema.parse(request.query);

    const doneReceipts = app.db
      .select({ purchasedAt: receipts.purchasedAt, totalOre: receipts.totalOre })
      .from(receipts)
      .where(and(eq(receipts.status, 'done'), isNotNull(receipts.purchasedAt)))
      .all();

    const endMonth = monthKey(todayInOslo(options.now()));
    const window = monthsWindow(endMonth, query.months);
    const totals = new Map(window.map((month) => [month, { totalOre: 0, receipts: 0 }]));

    for (const receipt of doneReceipts) {
      const bucket = totals.get(monthKey(receipt.purchasedAt as string));
      if (!bucket) {
        continue;
      }
      bucket.totalOre += receipt.totalOre ?? 0;
      bucket.receipts += 1;
    }

    const months = window.map((month) => ({ month, ...totals.get(month)! }));

    // All-time, not scoped to `months`: Product's own fields already mean all-time everywhere
    // else in the app (the products list, the product page), so a second, window-scoped
    // `timesBought` here would show a different number for the same product depending on screen.
    const statsByProduct = loadProductStatsMap(app.db);
    const topProducts = app.db
      .select()
      .from(products)
      .all()
      .map((product) => toProduct(product, statsByProduct.get(product.id) ?? NO_STATS))
      .sort((a, b) => b.timesBought - a.timesBought || a.name.localeCompare(b.name, 'nb'))
      .slice(0, TOP_PRODUCTS_LIMIT);

    return { months, topProducts };
  });
}
