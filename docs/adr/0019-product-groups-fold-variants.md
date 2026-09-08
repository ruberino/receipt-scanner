# ADR-0019: A parent product folds its variants

- Status: Accepted
- Date: 2026-09-08

## Context

Matching (ADR-0004) creates one product per name the receipt prints, and flavours and sizes print differently.
A household that buys the same yoghurt weekly in alternating flavours looks to the engine (ADR-0008) like two products bought every other week, so the `due` and `frequency` rules fire later than the household's actual habit.
The list then names one flavour, and the AI proposal (ADR-0016) may present another flavour as variation when it is really the same habit.
Merging the products would fix the engine and destroy the receipt-level truth: which variant, at what price, how often each.
Ruben asked whether two flavours of the same yoghurt should be one product; the foreman's answer, accepted by Ruben: not merged, grouped.

## Decision

- `products.parent_id` (nullable, `ON DELETE SET NULL`), depth exactly one: a product with a parent cannot itself be a parent, and a product with children cannot get a parent.
  A parent is an ordinary product row, may have receipt lines of its own (a receipt that prints only "SKYR MINI" matches it directly), and is what the group is called.
- Folding happens in one place, on the `ProductHistory[]` every downstream consumer already takes (`src/server/domain/productGroups.ts`): children's purchases are summed per date into the parent's history and the children disappear from the folded list; a suppressed child is left out of the fold; a suppressed parent hides the group.
  Suggestions, refresh, dismissals and the AI context therefore carry parent ids without further change; `computeTrip` (ADR-0018) learns the parent map so a variant line satisfies a planned group.
- Grouping and ungrouping are user actions on the product page; a pure heuristic offers candidates (same category, same first two words of the normalised name) and the user names the group.
  `POST /api/products/:id/merge` stays for what it is for: two names for the same product, a misnamed duplicate.
- The propose prompt (ADR-0016) gains one sentence about variants (prompt version 2, measured by acceptance rate as ADR-0016 already says, no eval set — there is no extraction change).

## Consequences

- One nullable column and one index.
- The product page shows a variant's own history and, on a parent, the variants and the group's folded statistics.
- A receipt line matched to a child counts for the group in every list-side view (suggestions, the shopping list, Handleturen), and to the child in every receipt-side view (the receipt itself, the product's own page) — which is the point: the group is a shopping-side convenience, the receipt keeps the truth.
- Grouping changes what the household is asked to buy; it stays a human decision on the product page, never automatic, even though a heuristic points at likely candidates.
- A parent deleted through merge (the only delete path for a product with children) leaves its former children with `parent_id = null`, ungrouped rather than orphaned.

## Alternatives considered

- Merging variants into one product: rejected — loses the variant (which flavour, at what price), and the merge is irreversible.
- A separate `product_groups` table: rejected — a parent that is a product already has a name, a category, a `suppressed` flag and a page, and can be matched by a receipt line directly; a second table would duplicate all of that.
- Nesting deeper than one level: rejected — no case in a household's groceries justifies the complexity, and the fold stays a single pass.
- Letting the matcher create groups: rejected — the matcher is a best-effort LLM step (ADR-0004); grouping changes what the household is asked to buy and stays a human decision.
