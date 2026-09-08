import type { FastifyBaseLogger } from 'fastify';
import { diffDays, isoWeekKey } from '../../shared/dates.ts';
import { calendarEvents, type CalendarEvent } from '../../shared/calendar.ts';
import type { ProductHistory } from './productStats.ts';

const RECENT_SCOPE_DAYS = 26 * 7;
const MAX_PURCHASES_PER_PRODUCT = 12;
const CALENDAR_HORIZON_DAYS = 21;
const SIZE_GUARD_CHARS = 40_000;
const FALLBACK_SCOPE_DAYS = 12 * 7;
const FALLBACK_MAX_PRODUCTS = 250;

const NORWEGIAN_WEEKDAYS = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];

export type ProposalContextProduct = {
  id: number;
  name: string;
  category: string | null;
  /** `"2026-09-04 x1"`, dates descending, at most the last 12. */
  purchases: string[];
  /** `purchases[0]`'s date, structured for `runProposal`'s own recency filter, so it does not have
   * to parse the formatted string back apart. */
  lastPurchaseDate: string;
  onList: boolean;
  dismissed: boolean;
  rejected: boolean;
  /** Names of this product's variants (T40, ADR-0019), omitted from the JSON when empty so an
   * ungrouped product (the common case) costs no extra tokens. */
  variants?: string[];
};

export type ProposalContext = {
  today: string;
  weekday: string;
  isoWeek: string;
  calendarEvents: CalendarEvent[];
  products: ProposalContextProduct[];
  listItems: string[];
};

/** One item from an earlier proposal on this list, as stored in `items_json`. */
export type PreviousProposalItem = { index: number; productId: number | null };

/** `acceptedIndexes` is `null` for a proposal never resolved (no accept call yet); its items do
 * not yet count as rejected. Cancelling records an accept with no indexes (`[]`), which does. */
export type PreviousProposal = {
  items: PreviousProposalItem[];
  acceptedIndexes: number[] | null;
};

export type BuildProposalContextInput = {
  histories: ProductHistory[];
  list: { items: { productId: number | null; name: string }[] };
  dismissedProductIds: ReadonlySet<number>;
  previousProposals: PreviousProposal[];
  today: string;
};

function weekdayInNorwegian(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  // Monday = 0 … Sunday = 6, matching `NORWEGIAN_WEEKDAYS`'s order.
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // Sunday = 0
  return NORWEGIAN_WEEKDAYS[(jsDay + 6) % 7] as string;
}

function rejectedProductIds(previousProposals: PreviousProposal[]): Set<number> {
  const rejected = new Set<number>();
  for (const proposal of previousProposals) {
    if (proposal.acceptedIndexes === null) {
      continue;
    }
    const accepted = new Set(proposal.acceptedIndexes);
    for (const item of proposal.items) {
      if (item.productId !== null && !accepted.has(item.index)) {
        rejected.add(item.productId);
      }
    }
  }
  return rejected;
}

/** Builds the products list for the context, scoped to purchases within `scopeDays` of `today`
 * and at most `MAX_PURCHASES_PER_PRODUCT` per product, newest first; a product with none in scope
 * is left out entirely — "anything older is not sent at all". */
function buildProducts(
  histories: ProductHistory[],
  scopeDays: number,
  today: string,
  flags: {
    onList: ReadonlySet<number>;
    dismissed: ReadonlySet<number>;
    rejected: ReadonlySet<number>;
  },
): ProposalContextProduct[] {
  const products: ProposalContextProduct[] = [];

  for (const history of histories) {
    if (history.suppressed) {
      continue;
    }
    const recentPurchases = history.purchases
      .filter((purchase) => {
        const age = diffDays(purchase.date, today);
        return age >= 0 && age <= scopeDays;
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (recentPurchases.length === 0) {
      continue;
    }

    products.push({
      id: history.productId,
      name: history.name,
      category: history.category,
      purchases: recentPurchases
        .slice(0, MAX_PURCHASES_PER_PRODUCT)
        .map((purchase) => `${purchase.date} x${purchase.quantity}`),
      lastPurchaseDate: recentPurchases[0]!.date,
      onList: flags.onList.has(history.productId),
      dismissed: flags.dismissed.has(history.productId),
      rejected: flags.rejected.has(history.productId),
      variants: history.variants.length > 0 ? history.variants : undefined,
    });
  }

  return products;
}

/**
 * Serialises the household's recent purchase history, the calendar and the list's current state
 * into the object sent as the `propose` call's user message (T37, ADR-0016); pure given its
 * inputs. Only products with at least one purchase in the last 26 weeks are included at all; a
 * context that still serialises over 40,000 characters is narrowed first to a 12-week purchase
 * scope, then to the 250 products with the most recent purchase, logging one `warn` line with the
 * counts either time.
 */
export function buildProposalContext(
  input: BuildProposalContextInput,
  logger?: Pick<FastifyBaseLogger, 'warn'>,
): ProposalContext {
  const onListProductIds = new Set(
    input.list.items
      .map((item) => item.productId)
      .filter((productId): productId is number => productId !== null),
  );
  const listItems = input.list.items.map((item) => item.name);
  const flags = {
    onList: onListProductIds,
    dismissed: input.dismissedProductIds,
    rejected: rejectedProductIds(input.previousProposals),
  };

  const baseContext: ProposalContext = {
    today: input.today,
    weekday: weekdayInNorwegian(input.today),
    isoWeek: isoWeekKey(input.today),
    calendarEvents: calendarEvents(input.today, CALENDAR_HORIZON_DAYS),
    products: buildProducts(input.histories, RECENT_SCOPE_DAYS, input.today, flags),
    listItems,
  };

  if (JSON.stringify(baseContext).length <= SIZE_GUARD_CHARS) {
    return baseContext;
  }

  const narrowedProducts = buildProducts(input.histories, FALLBACK_SCOPE_DAYS, input.today, flags);
  const cappedProducts = [...narrowedProducts]
    .sort((a, b) => (a.lastPurchaseDate < b.lastPurchaseDate ? 1 : -1))
    .slice(0, FALLBACK_MAX_PRODUCTS);

  logger?.warn(
    {
      originalProducts: baseContext.products.length,
      narrowedProducts: narrowedProducts.length,
      finalProducts: cappedProducts.length,
    },
    'Proposal context exceeded the size guard, narrowed to a 12-week scope and 250 products',
  );

  return { ...baseContext, products: cappedProducts };
}
