# T40 plan — Kvitteringer: varegrupper, one product with its variants

Foreman's task definition, 2026-09-08, from Ruben's question the same morning: two flavours of the same yoghurt are two products today, and he asked whether they should be one.
The foreman's answer, accepted by Ruben: not merged, grouped.
A receipt keeps the exact variant; the suggestion engine, the shopping list, the AI proposal and Handleturen work on the group.
Order: after T39; the Kvitteringer queue is otherwise empty.
Branch `task/T40-product-groups`, pull request per AGENTS.md, docs commit first; the docs commit must be pushed and read by the foreman before the implementation starts.

## The change in one paragraph

A product may have a parent product; the parent is the group ("Skyr mini") and the children are its variants ("Skyr mini jordbær", "Skyr mini banan"), one level deep.
Purchase histories are folded into the parent before anything downstream sees them, so the engine suggests the group with the group's weekly quantity, the list says the group's name and the household picks the variant in the shop, the AI proposal sees one product with a list of variants, and Handleturen counts any variant as the planned group bought.
Receipts, receipt lines, aliases, product stats and the products' own pages keep the variant.
Grouping is the user's decision on the product page, helped by a heuristic that points out likely groups and never acts on its own.
The existing merge stays for what it is for: two names for the same product.

## ADR-0019 — a parent product folds its variants

Write `docs/adr/0019-product-groups-fold-variants.md` with:

- Context: matching (ADR-0004) creates one product per name the receipt prints, and flavours and sizes print differently; a household that buys the same yoghurt weekly in alternating flavours looks to the engine (ADR-0008) like two products bought every other week, so the `due` and `frequency` rules fire later than the household's habit; the list then names one flavour, and the AI proposal (ADR-0016) may present another flavour as variation.
  Merging the products would fix the engine and destroy the receipt-level truth (which variant, at what price, how often each).
- Decision: `products.parent_id` (nullable, `ON DELETE SET NULL`), depth exactly one: a product with a parent cannot itself be a parent, and a product with children cannot get a parent.
  A parent is an ordinary product row, may have receipt lines of its own (a receipt that prints only "SKYR MINI" matches it directly), and is what the group is called.
  Folding happens in one place, on the `ProductHistory[]` every downstream consumer already takes: children's purchases are summed per date into the parent's history and the children disappear from the folded list; a suppressed child is left out of the fold; a suppressed parent hides the group.
  Suggestions, refresh, dismissals and the AI context therefore carry parent ids without further change; `computeTrip` learns the parent map so a variant line satisfies a planned group.
  Grouping and ungrouping are user actions on the product page; a pure heuristic offers candidates (same category, same first two words of the normalised name) and the user names the group.
  `POST /api/products/:id/merge` stays for misnamed duplicates and the UI says which of the two to use.
- Consequences: one nullable column and one index; the product page shows a variant's own history and, on a parent, the variants and the group's folded statistics; the propose prompt gains one sentence about variants (prompt version 2, measured by acceptance rate as ADR-0016 says, no eval set); a receipt line matched to a child counts for the group in every list-side view, and to the child in every receipt-side view, which is the point.
- Alternatives rejected: merging variants into one product (loses the variant, and the merge is irreversible); a separate `product_groups` table (a parent that is a product already has a name, a category, a `suppressed` flag and a page, and can be matched by a receipt line directly; a second table would duplicate all of that); nesting deeper than one level (no case in a household's groceries justifies the complexity, and the fold stays a single pass); letting the matcher create groups (the matcher is a best-effort LLM step; grouping changes what the household is asked to buy and stays a human decision).

## Data

- Migration `0007`: `ALTER TABLE products ADD COLUMN parent_id INTEGER REFERENCES products(id) ON DELETE SET NULL`, plus `CREATE INDEX products_parent ON products (parent_id)`.
  Plain `ADD COLUMN`; check the generated SQL keeps `ON DELETE SET NULL` (drizzle-kit dropped it in T39 and it had to be added by hand).
  The migration chain test shows existing products surviving with `null`, and deleting a parent (through merge, the only delete path) leaving its children with `parent_id = null`.
- `src/server/db/schema.ts`: `parentId` on `products` with a doc comment naming T40 and ADR-0019.
- `docs/architecture.md` section 6: the column in the `products` DDL and the depth-one rule in the table notes.

## Fold (`src/server/domain/productGroups.ts`, pure)

`foldHistories(histories: ProductHistory[], parentOf: ReadonlyMap<number, number>): ProductHistory[]`:

- A history whose `productId` has a parent is folded into the parent's history: purchases are merged by date, quantities summed, the unit of the most recent purchase kept; the child does not appear in the result.
- A parent with no history of its own gets one from its children, with the parent's `name`, `category` and `suppressed`; the caller passes the parents' product rows for that (`parents: { id, name, category, suppressed }[]`).
- A suppressed child contributes nothing; a suppressed parent stays suppressed (the engine already skips suppressed histories) and its children are still folded away.
- `ProductHistory` gains `variants: string[]` (names of the children that contributed, sorted `nb`), empty for an ungrouped product; the AI context uses it, the engine ignores it.
- `loadProductHistories` (`src/server/domain/productStats.ts`) returns the folded list; a new `loadProductHistoriesUnfolded` keeps the raw one for the places that need variants themselves (the parent's product page).
  Every current caller (`computeSuggestions` via the list routes and the suggestions route, `refresh`, `buildProposalContext`) gets grouping through that one change.
- Tests: two children fold into a parent with summed quantities on a shared date and the union of dates; a parent with its own purchases merges them with the children's; a suppressed child is left out; a suppressed parent stays out of suggestions; an ungrouped product is unchanged with `variants: []`; the weekly quantity text for the folded group is the median of weekly sums across variants (through `computeSuggestions`).

`findGroupCandidates(products: { id, name, category, parentId, suppressed }[]): GroupCandidate[]`:

- Considers unsuppressed products without a parent and without children; groups them by `category` and by the first two tokens of `normalizeText(name)` when the name has at least three tokens; a candidate needs at least two members.
- Returns `{ suggestedName, productIds }` with `suggestedName` the shared two tokens in the casing of the first member's name; sorted by member count descending then name; capped at 10.
- Tests: two flavours form a candidate with the shared prefix as name; a two-token name is never a candidate on its own; different categories do not group; an already grouped product is skipped.

## Trip (`src/server/domain/trip.ts`)

- `computeTrip` gains `parentOf: ReadonlyMap<number, number>` in its input.
- A planned item with `productId` P is `bought` when a line's `productId` is P or has parent P, or by the name rule that already exists; a planned item whose product is a child matches its own id only (an explicit variant on the list means that variant), plus the name rule.
- A line is not `unplanned` when its `productId` or its parent is among the planned product ids; unplanned rows stay grouped per variant, so the household sees which flavour came home.
- Tests: variant line satisfies the planned group; a planned variant is not satisfied by a sibling; a sibling of a planned variant is unplanned; the parent map empty behaves exactly as today (existing tests unchanged).
- `computeTripForList` (`src/server/routes/shoppingLists.ts`) loads the parent map for the products involved.

## Matching (`src/server/domain/matching.ts`)

- No behaviour change: parents are products and already appear in `loadKnownProductNames`, so a line that prints only the group name matches the parent.
- One sentence in architecture 7.5 says so.

## AI proposal (`src/server/domain/proposalContext.ts`, `src/server/llm/prompts/proposeList.prompt.ts`)

- `ProposalContextProduct` gains `variants: string[]` (omitted from the JSON when empty, to spend no tokens on ungrouped products).
- `PROPOSE_PROMPT_VERSION` becomes 2 with one added rule: a product may list variants (flavours, sizes); proposing a variant of a product that is on the list, dismissed, rejected or recently bought is not variation and must not be proposed; name the product, not the variant, and the household chooses in the shop.
- Parser: a returned name that resolves to a child whose parent is on the list, dismissed or rejected is filtered like the parent; a returned child name otherwise resolves to the parent's id (the list gets the group).
- Tests: context carries `variants` for a group and omits the key for an ungrouped product; the parser maps a child name to the parent id and filters it when the parent is on the list.
- No eval run; ADR-0016's acceptance-rate rule applies, and AGENTS.md already says so.

## API (`src/shared/schemas.ts`, `src/server/routes/products.ts`)

- `productSchema` gains `parentId: number | null` and `variantCount: number` (0 for anything that is not a parent).
- `productDetailSchema` gains `parent: { id, name } | null`, `variants: { id, name, timesBought, lastBought }[]`, and `groupStats: ProductStats | null` (the folded `timesBought`, `lastBought`, `medianIntervalDays` for a parent, `null` otherwise); `purchases` stays the product's own lines.
- `POST /api/products/:id/parent { parentId }` attaches; `409 Produktet er allerede en varegruppe` when the product has children, `409 Varegruppen kan ikke ligge i en annen gruppe` when the target has a parent, `400` when `parentId === id`, `404` when either is missing; returns the child as `Product`.
- `DELETE /api/products/:id/parent` detaches, `204`; `404` when the product has no parent.
- `POST /api/product-groups { name, category?, memberIds: number[] }` creates the parent product (category defaults to the first member's) and attaches every member in one transaction with the same checks as attach; `201 ProductDetail` of the parent; `409` on a duplicate normalised name, in which case the client offers to attach to the existing product instead.
- `GET /api/products/group-candidates` returns `findGroupCandidates` over all products, `200 GroupCandidate[]`.
- `GET /api/products?q=` is unchanged in shape apart from the two new fields; children sort directly after their parent when both are in the result.
- Tests per AGENTS.md: `401` on each new endpoint; attach, detach, the three conflict cases, group creation with two members, duplicate name `409`, candidates; the product detail of a parent with `variants` and `groupStats`; merge of a child into a sibling keeps the parent; merge that deletes a parent nulls its children.

## Client

- `ProductPage`: a `Varegruppe` section between `Ikke foreslå` and `Alias`.
  For a variant: `Variant av «Skyr mini»` as a link, and `Fjern fra gruppen`.
  For a parent: `Varianter (n)` as links with each variant's `n ganger, sist <date>`, a line `Gruppen: kjøpt n ganger, sist <date>, ca. hver n. dag` from `groupStats`, and no `Legg i gruppe`.
  For an ungrouped product: `Legg i gruppe…` opens the existing `ProductPicker` combobox; choosing a parent attaches; choosing an ungrouped product opens a one-field dialog `Navn på varegruppen` prefilled with the shared first two words, and `Lag gruppe` calls `POST /api/product-groups` with both ids; the picker's `Opprett «…»` creates a new parent with that name and this product as its only member.
  The merge confirm text gains a second sentence: `Er det varianter av samme vare, bruk Varegruppe i stedet.`
- `ProductsPage`: a collapsed `Kan være samme vare (n)` block above the list when candidates exist, each row `Skyr mini jordbær, Skyr mini banan → «Skyr mini»` with a `Grupper` button that creates the group with the suggested name (editable inline before confirming); rows disappear once grouped or when the user taps `Ikke nå` for that candidate (remembered in `localStorage` by the sorted member ids, no server state).
  In the list, a child renders indented under its parent when both are present, otherwise with a `variant av …` line under the name.
- `ShoppingListPage`: no change in behaviour; a suggested group renders with the parent's name and the folded quantity.
  The suggestion reason keeps its wording.
- `ShoppingListDetailPage`: unplanned rows already link to the product page; nothing new.
- 44 px targets at 360 px width; Playwright walk with screenshots under `docs/reviews/screenshots/T40/`: product page of a variant, of a parent, the candidates block, and a shopping list row for a group.
- Tests: product page for each of the three states and the two grouping flows; products page candidates with `Grupper` and `Ikke nå`; indentation; the picker dialog default name.

## Acceptance criteria

- With two products bought on alternating weeks for eight weeks and grouped under one parent, the engine suggests the parent every week with the folded weekly quantity, and neither child appears; ungrouped they are suggested as today.
- A list item for the parent counts as bought in Handleturen when the receipt has either variant; a sibling of an explicitly listed variant shows under `Utenom lista`.
- The AI context carries `variants` for grouped products and the prompt version is 2; a proposal naming a variant of an on-list group is filtered.
- The product page can group, name the group, and ungroup; the depth-one rule gives `409` on both violations; deleting a parent through merge leaves its children ungrouped.
- A receipt line whose text is the bare group name matches the parent product.
- The products page offers group candidates for at least the two-flavour case and hides one on `Ikke nå`.
- Existing products survive migration `0007` with `parent_id = null`; the generated SQL carries `ON DELETE SET NULL`.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass; no extraction eval (no extraction prompt, model or schema change).

## Tests (summary)

Fold with summed quantities, dates, units, suppressed child and parent, `variants`; candidates heuristic; trip with a parent map; proposal context `variants` and parser mapping; routes (`401`s, attach, detach, conflicts, group creation, duplicate name, candidates, detail of a parent, merge interactions); migration survival and `SET NULL`; engine end to end with grouped histories; client pages and flows.

## After the merge (foreman)

The demo gets the new version once its queue is empty, with a database backup first (migration).
The real-data check: the foreman groups the household's yoghurt variants on the demo through the UI, refreshes the open list or creates one, and records in `docs/reviews/T40-review.md` only counts (how many products grouped, suggestions before and after, quantity text of the group) and whether the candidates block proposed the group unaided; product names go to Ruben directly (public repository, architecture section 11).
