import { normalizeText } from '../../shared/normalize.ts';
import type { ProductHistory, ProductPurchase } from './productStats.ts';

export type ProductGroupParent = {
  id: number;
  name: string;
  category: string | null;
  suppressed: boolean;
};

function foldOne(parent: ProductHistory, children: ProductHistory[]): ProductHistory {
  const byDate = new Map<string, ProductPurchase>();
  for (const purchase of parent.purchases) {
    byDate.set(purchase.date, { ...purchase });
  }
  for (const child of children) {
    for (const purchase of child.purchases) {
      const existing = byDate.get(purchase.date);
      if (existing) {
        // Same-day purchases across the group are summed; only the date is shared information, so
        // the unit is simply whichever purchase is folded in last for that date.
        existing.quantity += purchase.quantity;
        existing.unit = purchase.unit;
      } else {
        byDate.set(purchase.date, { ...purchase });
      }
    }
  }

  return {
    productId: parent.productId,
    name: parent.name,
    category: parent.category,
    suppressed: parent.suppressed,
    purchases: [...byDate.values()],
    variants: children.map((child) => child.name).sort((a, b) => a.localeCompare(b, 'nb')),
  };
}

/**
 * Folds a variant's purchase history into its parent's (T40, ADR-0019), so the suggestion engine,
 * `refresh`, dismissals and the AI proposal context see one row per group instead of one per
 * variant; a receipt, its lines, aliases and a product's own stats are untouched by this and keep
 * the exact variant, since they never go through `ProductHistory`.
 *
 * A suppressed child contributes nothing to the fold, its purchases excluded from the sum. A
 * suppressed parent still folds its children in — the group's row keeps `suppressed: true`, and
 * every current caller already skips a suppressed history, hiding the whole group. `parents` is
 * the product rows for every id `parentOf` points at, needed to build a row for a parent with no
 * purchase history of its own (its children may still have plenty).
 */
export function foldHistories(
  histories: ProductHistory[],
  parentOf: ReadonlyMap<number, number>,
  parents: ProductGroupParent[],
): ProductHistory[] {
  const byProductId = new Map(histories.map((history) => [history.productId, history]));
  const parentsById = new Map(parents.map((parent) => [parent.id, parent]));

  const childrenOf = new Map<number, ProductHistory[]>();
  for (const history of histories) {
    if (history.suppressed) {
      continue;
    }
    const parentId = parentOf.get(history.productId);
    if (parentId === undefined) {
      continue;
    }
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.push(history);
    childrenOf.set(parentId, siblings);
  }

  const folded: ProductHistory[] = [];
  const foldedParentIds = new Set<number>();

  for (const history of histories) {
    if (parentOf.has(history.productId)) {
      continue; // A child: folded into its parent below, never appears on its own.
    }
    const children = childrenOf.get(history.productId) ?? [];
    if (children.length === 0) {
      folded.push({ ...history, variants: [] });
      continue;
    }
    foldedParentIds.add(history.productId);
    folded.push(foldOne(history, children));
  }

  // A parent with children but no purchase of its own has no entry in `histories` yet.
  for (const [parentId, children] of childrenOf) {
    if (foldedParentIds.has(parentId) || byProductId.has(parentId)) {
      continue;
    }
    const parent = parentsById.get(parentId);
    if (!parent) {
      continue;
    }
    folded.push(
      foldOne(
        {
          productId: parent.id,
          name: parent.name,
          category: parent.category,
          suppressed: parent.suppressed,
          purchases: [],
          variants: [],
        },
        children,
      ),
    );
  }

  return folded;
}

export type GroupCandidateProduct = {
  id: number;
  name: string;
  category: string | null;
  parentId: number | null;
  suppressed: boolean;
};

export type GroupCandidate = { suggestedName: string; productIds: number[] };

const MAX_CANDIDATES = 10;
const MIN_TOKENS_FOR_CANDIDATE = 3;
const PREFIX_TOKENS = 2;

/**
 * Points out likely variant groups (T40, ADR-0019) without ever acting on its own: unsuppressed
 * products with neither a parent nor children, grouped by category and the first two tokens of
 * `normalizeText(name)` (a name with fewer than three tokens has no differentiating third token
 * left over for a flavour or size, so it can never anchor a group on its own).
 */
export function findGroupCandidates(products: GroupCandidateProduct[]): GroupCandidate[] {
  const parentIds = new Set(
    products.map((product) => product.parentId).filter((id): id is number => id !== null),
  );
  const eligible = products.filter(
    (product) => !product.suppressed && product.parentId === null && !parentIds.has(product.id),
  );

  const groups = new Map<string, GroupCandidateProduct[]>();
  for (const product of eligible) {
    const tokens = normalizeText(product.name).split(' ').filter(Boolean);
    if (tokens.length < MIN_TOKENS_FOR_CANDIDATE) {
      continue;
    }
    const key = `${product.category ?? ''}::${tokens.slice(0, PREFIX_TOKENS).join(' ')}`;
    const members = groups.get(key) ?? [];
    members.push(product);
    groups.set(key, members);
  }

  const candidates: GroupCandidate[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) {
      continue;
    }
    const firstNameWords = members[0]!.name.split(/\s+/).filter(Boolean);
    candidates.push({
      suggestedName: firstNameWords.slice(0, PREFIX_TOKENS).join(' '),
      productIds: members.map((member) => member.id),
    });
  }

  return candidates
    .sort(
      (a, b) =>
        b.productIds.length - a.productIds.length ||
        a.suggestedName.localeCompare(b.suggestedName, 'nb'),
    )
    .slice(0, MAX_CANDIDATES);
}
