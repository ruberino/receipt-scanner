import type { FastifyInstance } from 'fastify';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { todayInOslo } from '../../shared/dates.ts';
import type { AppDatabase } from '../db/client.ts';
import { products, receipts, shoppingListProposals, shoppingLists } from '../db/schema.ts';
import { loadProductStatsMap, type ProductStats } from '../domain/productStats.ts';
import { toProduct } from './products.ts';
import { computeTripForList } from './shoppingLists.ts';

const NO_STATS: ProductStats = { timesBought: 0, lastBought: null, medianIntervalDays: null };
const TOP_PRODUCTS_LIMIT = 10;

const summaryQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});

function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** All-time acceptance-rate inputs over every proposal ever made (T37, ADR-0016): small counts at
 * household scale, so summing in memory needs no extra columns or triggers. `boughtItems` comes
 * from `loadTripsAndAiPurchaseStats` (T39): every `source = 'ai'` list item is, by construction,
 * an accepted proposal item, so summing "bought" ai items across every list's trip already is the
 * count without linking a purchase back to the specific proposal it came from. */
function loadAiProposalsStats(db: AppDatabase) {
  const rows = db
    .select({
      itemsJson: shoppingListProposals.itemsJson,
      acceptedJson: shoppingListProposals.acceptedJson,
    })
    .from(shoppingListProposals)
    .all();

  return rows.reduce(
    (totals, row) => {
      const items = JSON.parse(row.itemsJson) as unknown[];
      totals.proposals += 1;
      totals.proposedItems += items.length;
      if (row.acceptedJson !== null) {
        const accepted = JSON.parse(row.acceptedJson) as unknown[];
        totals.acceptedItems += accepted.length;
      }
      return totals;
    },
    { proposals: 0, proposedItems: 0, acceptedItems: 0 },
  );
}

/** All-time trip counts over every `done` list (T39, ADR-0018), plus the ai-proposal purchase
 * count `loadAiProposalsStats` needs; computed together so each list's trip is built only once. */
function loadTripsAndAiPurchaseStats(db: AppDatabase) {
  const doneLists = db.select().from(shoppingLists).where(eq(shoppingLists.status, 'done')).all();

  const trips = {
    completedLists: doneLists.length,
    listsWithReceipt: 0,
    plannedItems: 0,
    boughtItems: 0,
    unplannedItems: 0,
  };
  let aiBoughtItems = 0;

  for (const list of doneLists) {
    const trip = computeTripForList(db, list);
    if (trip === null) {
      continue;
    }
    trips.listsWithReceipt += 1;
    trips.plannedItems += trip.counts.planned;
    trips.boughtItems += trip.counts.bought;
    trips.unplannedItems += trip.counts.unplanned;
    aiBoughtItems += trip.planned.filter(
      (row) => row.source === 'ai' && row.status === 'bought',
    ).length;
  }

  return { trips, aiBoughtItems };
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
    const allProducts = app.db.select().from(products).all();
    const variantCounts = new Map<number, number>();
    for (const product of allProducts) {
      if (product.parentId !== null) {
        variantCounts.set(product.parentId, (variantCounts.get(product.parentId) ?? 0) + 1);
      }
    }
    const topProducts = allProducts
      .map((product) =>
        toProduct(
          product,
          statsByProduct.get(product.id) ?? NO_STATS,
          variantCounts.get(product.id) ?? 0,
        ),
      )
      .sort((a, b) => b.timesBought - a.timesBought || a.name.localeCompare(b.name, 'nb'))
      .slice(0, TOP_PRODUCTS_LIMIT);

    const { trips, aiBoughtItems } = loadTripsAndAiPurchaseStats(app.db);
    const aiProposals = { ...loadAiProposalsStats(app.db), boughtItems: aiBoughtItems };

    return { months, topProducts, aiProposals, trips };
  });
}
