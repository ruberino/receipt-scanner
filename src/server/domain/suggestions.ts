import { diffDays, isoWeekKey, mondayOf } from '../../shared/dates.ts';
import type { ProductHistory, ProductPurchase } from './productStats.ts';

/** A product bought within this many days of `today` was already bought "this trip". */
const RECENT_PURCHASE_DAYS = 3;
/** A product not bought for longer than this (and not within 3x its own median gap) is stale. */
const STALE_MAX_DAYS = 60;
const STALE_MEDIAN_GAP_FACTOR = 3;
/** `dueIn = medianGap - daysSinceLast`; at or below this many days out counts as due. */
const DUE_SOON_DAYS = 3;
const FREQUENCY_WINDOW_DAYS = 84;
const FREQUENCY_WINDOW_WEEKS = 12;
const FREQUENCY_THRESHOLD = 0.5;

export type Suggestion = {
  productId: number;
  name: string;
  category: string | null;
  reason: string;
  quantityText: string;
  score: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/** `7` stays a whole number in the reason text; a half-week median (e.g. `10.5`) gets a Norwegian comma. */
function formatMedianGap(medianGap: number): string {
  return Number.isInteger(medianGap) ? String(medianGap) : medianGap.toFixed(1).replace('.', ',');
}

/** Section 8, step 11: only `kg` gets a decimal; `stk` and `l` (and no unit) round to a whole count. */
function formatQuantityText(purchases: ProductPurchase[]): string {
  const medianQuantity = median(purchases.map((purchase) => purchase.quantity));
  const mostRecentUnit = purchases.reduce((latest, purchase) =>
    purchase.date > latest.date ? purchase : latest,
  ).unit;

  if (mostRecentUnit === 'kg') {
    return `${medianQuantity.toFixed(1).replace('.', ',')} kg`;
  }
  return `${Math.max(1, Math.round(medianQuantity))} stk`;
}

/**
 * Pure, deterministic suggestion engine (ADR-0008); the algorithm and worked example in
 * architecture.md section 8 are normative. No I/O: `histories` comes from `loadProductHistories`.
 */
export function computeSuggestions(histories: ProductHistory[], today: string): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const history of histories) {
    if (history.suppressed) {
      continue;
    }

    const dates = history.purchases.map((purchase) => purchase.date);

    // One representative date per distinct ISO week, so weekly gaps can be measured from its Monday.
    const dateByWeekKey = new Map<string, string>();
    for (const date of dates) {
      const weekKey = isoWeekKey(date);
      if (!dateByWeekKey.has(weekKey)) {
        dateByWeekKey.set(weekKey, date);
      }
    }
    const distinctWeeks = [...dateByWeekKey.keys()].sort();
    if (distinctWeeks.length < 2) {
      continue;
    }

    const lastPurchaseDate = dates.reduce((latest, date) => (date > latest ? date : latest));
    const daysSinceLast = diffDays(lastPurchaseDate, today);
    if (daysSinceLast <= RECENT_PURCHASE_DAYS) {
      continue;
    }

    const weekGaps: number[] = [];
    for (let i = 1; i < distinctWeeks.length; i += 1) {
      const previousMonday = mondayOf(dateByWeekKey.get(distinctWeeks[i - 1]!)!);
      const currentMonday = mondayOf(dateByWeekKey.get(distinctWeeks[i]!)!);
      weekGaps.push(diffDays(previousMonday, currentMonday) / 7);
    }
    const medianGap = 7 * median(weekGaps);

    if (daysSinceLast > Math.max(STALE_MAX_DAYS, STALE_MEDIAN_GAP_FACTOR * medianGap)) {
      continue;
    }

    const dueIn = medianGap - daysSinceLast;
    const dueRule = dueIn <= DUE_SOON_DAYS;

    const weeksBought = new Set(
      dates
        .filter((date) => diffDays(date, today) <= FREQUENCY_WINDOW_DAYS)
        .map((date) => isoWeekKey(date)),
    ).size;
    const freqRule = weeksBought / FREQUENCY_WINDOW_WEEKS >= FREQUENCY_THRESHOLD;

    if (!dueRule && !freqRule) {
      continue;
    }

    const reason = dueRule
      ? `Kjøpes ca. hver ${formatMedianGap(medianGap)}. dag, sist for ${daysSinceLast} dager siden`
      : `Kjøpt ${weeksBought} av de siste 12 ukene`;

    suggestions.push({
      productId: history.productId,
      name: history.name,
      category: history.category,
      reason,
      quantityText: formatQuantityText(history.purchases),
      score: daysSinceLast / medianGap,
    });
  }

  return suggestions.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'nb'));
}
