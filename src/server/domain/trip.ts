import { normalizeText } from '../../shared/normalize.ts';

export type TripItemSource = 'suggested' | 'manual' | 'ai';
export type TripLineUnit = 'stk' | 'kg' | 'l' | null;

export type TripItem = {
  id: number;
  productId: number | null;
  name: string;
  quantityText: string | null;
  source: TripItemSource;
  checked: boolean;
};

/** An `item`-kind receipt line from a receipt linked to the list; the caller filters to `item`
 * lines only (T39, ADR-0018) — a discount or deposit line is never passed in. */
export type TripLine = {
  receiptId: number;
  productId: number | null;
  rawText: string;
  quantity: number;
  unit: TripLineUnit;
};

export type ComputeTripInput = {
  items: TripItem[];
  lines: TripLine[];
  /** Product names for the products referenced by `lines`, so an unplanned/matched line can show
   * its canonical name rather than the raw receipt text. */
  productNames: Map<number, string>;
  /** `productId -> parentId` for every variant referenced by `lines` (T40, ADR-0019); empty for a
   * household with no groups, in which case this function behaves exactly as it did before T40. */
  parentOf: ReadonlyMap<number, number>;
};

export type TripPlannedRow = {
  itemId: number;
  name: string;
  quantityText: string | null;
  source: TripItemSource;
  checked: boolean;
  status: 'bought' | 'notBought';
};

export type TripUnplannedRow = {
  productId: number | null;
  name: string;
  quantity: number;
  unit: TripLineUnit;
};

export type Trip = {
  planned: TripPlannedRow[];
  unplanned: TripUnplannedRow[];
  counts: { planned: number; bought: number; notBought: number; unplanned: number };
  receiptIds: number[];
};

function lineDisplayName(line: TripLine, productNames: Map<number, string>): string {
  if (line.productId !== null) {
    return productNames.get(line.productId) ?? line.rawText;
  }
  return line.rawText;
}

/**
 * Compares a list's items against the item lines of its linked receipts (T39, ADR-0018): pure
 * given its inputs, computed on every read, nothing stored back.
 *
 * A planned item is `bought` when a line shares its `productId`, or a line's product is a variant
 * of it (`parentOf`, T40, ADR-0019 — an item whose own product is itself a variant only matches
 * its own id this way, since depth is exactly one and nothing points at a variant as a parent), or
 * when a line's display name (its product's name, or its raw text when it has none) normalises to
 * the same text as the item's name — the name check applies to every item, with or without a
 * product, since a line can fail product matching (ADR-0004) and still read the same text as a
 * planned item that did match a product; otherwise `notBought`.
 * A line is `unplanned` when neither its own `productId` nor its parent is one of the planned
 * items' product ids (for a line with a product), or its normalised raw text matches no planned
 * item's name (for a line without one); unplanned lines are grouped by product id (or normalised
 * text when there is none) — a variant stays its own group, so the household sees which flavour
 * came home — quantities summed, keeping the unit of the first line in each group.
 */
export function computeTrip({ items, lines, productNames, parentOf }: ComputeTripInput): Trip {
  const lineProductIdsOrParents = new Set<number>();
  const lineNames = new Set<string>();
  for (const line of lines) {
    if (line.productId !== null) {
      lineProductIdsOrParents.add(line.productId);
      const parentId = parentOf.get(line.productId);
      if (parentId !== undefined) {
        lineProductIdsOrParents.add(parentId);
      }
    }
    lineNames.add(normalizeText(lineDisplayName(line, productNames)));
  }

  const plannedProductIds = new Set<number>();
  const plannedNames = new Set<string>();
  for (const item of items) {
    if (item.productId !== null) {
      plannedProductIds.add(item.productId);
    }
    plannedNames.add(normalizeText(item.name));
  }

  const planned: TripPlannedRow[] = items.map((item) => {
    const bought =
      (item.productId !== null && lineProductIdsOrParents.has(item.productId)) ||
      lineNames.has(normalizeText(item.name));
    return {
      itemId: item.id,
      name: item.name,
      quantityText: item.quantityText,
      source: item.source,
      checked: item.checked,
      status: bought ? 'bought' : 'notBought',
    };
  });

  const unplannedGroups = new Map<string, TripUnplannedRow>();
  for (const line of lines) {
    if (line.productId !== null) {
      const parentId = parentOf.get(line.productId);
      if (
        plannedProductIds.has(line.productId) ||
        (parentId !== undefined && plannedProductIds.has(parentId))
      ) {
        continue;
      }
      const key = `p:${line.productId}`;
      const existing = unplannedGroups.get(key);
      if (existing) {
        existing.quantity += line.quantity;
      } else {
        unplannedGroups.set(key, {
          productId: line.productId,
          name: lineDisplayName(line, productNames),
          quantity: line.quantity,
          unit: line.unit,
        });
      }
    } else {
      const normalized = normalizeText(line.rawText);
      if (plannedNames.has(normalized)) {
        continue;
      }
      const key = `n:${normalized}`;
      const existing = unplannedGroups.get(key);
      if (existing) {
        existing.quantity += line.quantity;
      } else {
        unplannedGroups.set(key, {
          productId: null,
          name: line.rawText,
          quantity: line.quantity,
          unit: line.unit,
        });
      }
    }
  }

  const unplanned = [...unplannedGroups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'nb'),
  );
  const bought = planned.filter((row) => row.status === 'bought').length;
  const receiptIds = [...new Set(lines.map((line) => line.receiptId))].sort((a, b) => a - b);

  return {
    planned,
    unplanned,
    counts: {
      planned: planned.length,
      bought,
      notBought: planned.length - bought,
      unplanned: unplanned.length,
    },
    receiptIds,
  };
}
