import type { FastifyBaseLogger } from 'fastify';
import { diffDays, isoWeekKey } from '../../shared/dates.ts';
import { calendarEvents, type CalendarEvent } from '../../shared/calendar.ts';
import type { ProductHistory } from './productStats.ts';

const RECENT_SCOPE_DAYS = 26 * 7;
const MAX_PURCHASES_PER_PRODUCT = 12;
const CALENDAR_HORIZON_DAYS = 21;
const FALLBACK_SCOPE_DAYS = 12 * 7;

/**
 * Provisional (T45, issue #15). 40,000 was chosen before anyone had seen a real context, and a
 * two-month-old household tripped it. 120,000 is roughly 30k prompt tokens at four characters per
 * token — but that ratio is an English-prose rule of thumb applied to JSON whose bulk is
 * `"2026-09-04 x1"` strings, so the true ceiling may be nearer 55k tokens and twice the cost. At
 * 30k tokens a tap is about 0.3 NOK on `kimi-k2.6`'s published input price, roughly 15 NOK a year
 * for a weekly tap, the same order as the whole receipt budget in architecture section 14.
 *
 * The narrowing below now logs the serialised length and `runProposal` already logs
 * `promptTokens`, so the first real proposal after this carries both numbers for one call and the
 * ratio is a division. Move this constant against that measurement and delete this note.
 */
const SIZE_GUARD_CHARS = 120_000;

/** Each rung is the whole context rebuilt with tighter limits, not a patch on the one before, so
 * the result stays a pure function of the inputs. Cumulative: purchases come off before products,
 * because a household with a year of receipts is long before it is wide. */
type NarrowingRung = {
  /** Named in the log, so one line says which rung stopped the ladder. */
  step: string;
  scopeDays: number;
  maxPurchases: number;
  maxProducts: number | null;
};

const NARROWING_LADDER: readonly NarrowingRung[] = [
  {
    step: 'scope-12-weeks',
    scopeDays: FALLBACK_SCOPE_DAYS,
    maxPurchases: MAX_PURCHASES_PER_PRODUCT,
    maxProducts: null,
  },
  {
    step: 'products-250',
    scopeDays: FALLBACK_SCOPE_DAYS,
    maxPurchases: MAX_PURCHASES_PER_PRODUCT,
    maxProducts: 250,
  },
  { step: 'purchases-6', scopeDays: FALLBACK_SCOPE_DAYS, maxPurchases: 6, maxProducts: 250 },
  { step: 'purchases-3', scopeDays: FALLBACK_SCOPE_DAYS, maxPurchases: 3, maxProducts: 250 },
  { step: 'purchases-1', scopeDays: FALLBACK_SCOPE_DAYS, maxPurchases: 1, maxProducts: 250 },
  { step: 'products-150', scopeDays: FALLBACK_SCOPE_DAYS, maxPurchases: 1, maxProducts: 150 },
  { step: 'products-75', scopeDays: FALLBACK_SCOPE_DAYS, maxPurchases: 1, maxProducts: 75 },
];

const NORWEGIAN_WEEKDAYS = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];

export type ProposalContextProduct = {
  id: number;
  name: string;
  category: string | null;
  /** `"2026-09-04 x1"`, dates descending, at most the last 12 — fewer when the narrowing ladder
   * had to cut them back to fit the size guard (T45). */
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
 * and at most `maxPurchases` per product, newest first; a product with none in scope is left out
 * entirely — "anything older is not sent at all". */
function buildProducts(
  histories: ProductHistory[],
  scopeDays: number,
  maxPurchases: number,
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
        .slice(0, maxPurchases)
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

/** The products with the most recent purchase. `id` breaks a tie, so the cut is a total order:
 * a weekly shop gives dozens of products the same `lastPurchaseDate`, and without the tiebreak the
 * comparator answers -1 in both directions for those and the 250 that survive are whatever the
 * sort happened to do (T45). */
function capProducts(
  products: ProposalContextProduct[],
  maxProducts: number | null,
): ProposalContextProduct[] {
  if (maxProducts === null) {
    return products;
  }
  return [...products]
    .sort((a, b) =>
      a.lastPurchaseDate === b.lastPurchaseDate
        ? a.id - b.id
        : a.lastPurchaseDate < b.lastPurchaseDate
          ? 1
          : -1,
    )
    .slice(0, maxProducts);
}

/**
 * Serialises the household's recent purchase history, the calendar and the list's current state
 * into the object sent as the `propose` call's user message (T37, ADR-0016); pure given its
 * inputs. Only products with at least one purchase in the last 26 weeks are included at all; a
 * context that still serialises over `SIZE_GUARD_CHARS` walks `NARROWING_LADDER` until it fits,
 * stopping at the first rung that does and logging one `info` line naming that rung and the
 * serialised length before and after. If no rung brings it under, the context is returned anyway —
 * a proposal that costs more is better than no proposal — and that is the one case that warns
 * (T45, issue #15).
 */
export function buildProposalContext(
  input: BuildProposalContextInput,
  logger?: Pick<FastifyBaseLogger, 'info' | 'warn'>,
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
    products: buildProducts(
      input.histories,
      RECENT_SCOPE_DAYS,
      MAX_PURCHASES_PER_PRODUCT,
      input.today,
      flags,
    ),
    listItems,
  };

  const originalChars = JSON.stringify(baseContext).length;
  if (originalChars <= SIZE_GUARD_CHARS) {
    return baseContext;
  }

  let narrowed = baseContext;
  let finalChars = originalChars;
  let step = 'none';
  let fits = false;

  for (const rung of NARROWING_LADDER) {
    narrowed = {
      ...baseContext,
      products: capProducts(
        buildProducts(input.histories, rung.scopeDays, rung.maxPurchases, input.today, flags),
        rung.maxProducts,
      ),
    };
    finalChars = JSON.stringify(narrowed).length;
    step = rung.step;
    if (finalChars <= SIZE_GUARD_CHARS) {
      fits = true;
      break;
    }
  }

  // The lengths are the serialised lengths that were actually measured, not estimates from the
  // product counts: they are the numbers that say whether the guard is set anywhere near right,
  // and issue #15 exists because nobody logged them.
  const details = {
    step,
    guardChars: SIZE_GUARD_CHARS,
    originalChars,
    finalChars,
    originalProducts: baseContext.products.length,
    finalProducts: narrowed.products.length,
  };

  if (fits) {
    logger?.info(details, 'Proposal context narrowed to fit the size guard');
  } else {
    logger?.warn(
      details,
      'Proposal context is still over the size guard after every narrowing step',
    );
  }

  return narrowed;
}
