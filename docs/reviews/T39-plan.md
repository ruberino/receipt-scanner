# T39 plan — Kvitteringer: Handleturen, the completed list meets the receipt

Foreman's task definition, 2026-09-07, from Ruben's acceptance of the foreman's feature proposal the same evening.
The two halves of the app do not meet today: the list proposes (rule engine, ADR-0008; AI, ADR-0016), the household shops, the receipt is read, and nothing shows whether the plan was followed.
Ruben set acceptance rate as the quality metric for the AI proposal (ADR-0016) and the weekly frame for the list (T36); this task adds the outcome behind both: what was actually bought.
Order: after T38; the Kvitteringer queue is otherwise empty.
Branch `task/T39-shopping-trip`, pull request per AGENTS.md, docs commit first; this task is large enough that the docs commit must be pushed and read by the foreman before the implementation starts.

## The change in one paragraph

A receipt can belong to a shopping list.
The link is made automatically when the receipt's purchase date and the list's completion day are the same day or one day apart, and can be set or removed by hand on the receipt page.
A completed list with at least one linked receipt shows `Handleturen`: what was bought as planned, what was not bought, and what was bought outside the list, computed on read from the list's items and the receipts' lines, never stored.
The statistics section gets the numbers over all trips and the AI proposal's acceptance and purchase figures.
The rule engine and the proposal prompt are untouched: this task measures, a later task may act on what the numbers say.

## ADR-0018 — a receipt belongs to a list; the outcome is computed, not stored

Write `docs/adr/0018-shopping-trip-outcome.md` with:

- Context: the list is the week's shopping (T36) and the AI proposal is measured by acceptance (ADR-0016), but accepted is not bought; the receipts already hold the truth, line by line, matched to the same products the list items point at.
- Decision: `receipts.shopping_list_id` (nullable, `ON DELETE SET NULL`) is the only new persisted fact; several receipts may belong to one list (two shops on one trip), a receipt to at most one list.
  The link is made automatically at two moments, when a receipt reaches `done` and when a list is completed, by one pure rule (below), and the user can override it on the receipt page.
  The comparison (`Trip`) is a pure function of the list's items and the linked receipts' lines, computed on every read; nothing about the outcome is written back to the list, the products or the engine in this task.
  The statistics add purchase counts next to the acceptance counts; both engines are judged by the same receipts.
- Consequences: a re-read receipt (`done` again) may re-link automatically after the user unlinked it, accepted and noted on the receipt page's selector; a list deleted by the user leaves its receipts with `shopping_list_id = null`; matching manual and AI items without a product to receipt lines goes through `normalizeText` on names, which will miss spelling variants, and such an item then counts as not bought — visible in the UI, so the user can fix the product match on the receipt and the trip updates on the next read.
- Alternatives rejected: storing the trip outcome per item (a second source of truth that goes stale when a line is re-matched or a receipt re-read); a `shopping_trips` table between lists and receipts (the list already is the trip, T36); feeding the outcome straight into the suggestion engine (no data yet to say what a good rule is; ADR-0008 stays as it is until the trips show a pattern).

## Data

- Migration `0006`: `ALTER TABLE receipts ADD COLUMN shopping_list_id INTEGER REFERENCES shopping_lists(id) ON DELETE SET NULL`, plus `CREATE INDEX receipts_shopping_list ON receipts (shopping_list_id)`.
  A plain `ADD COLUMN`, no table recreate; the migration chain test shows existing receipts surviving with `null` and a list deletion leaving its receipt in place with `null`.
- `src/server/db/schema.ts`: the column on `receipts` with a doc comment naming T39 and ADR-0018.
- `docs/architecture.md` section 6: the column in the `receipts` DDL and one sentence under the table notes.

## Linking rule (`src/server/domain/tripLink.ts`, pure)

`findTripList(purchaseDate: string, candidates: { id: number; completedAt: string }[]): number | null`:

- A candidate's completion day is `todayInOslo(new Date(completedAt))` (`src/shared/dates.ts`), so the comparison is between two civil dates in Oslo (ADR-0007).
- A candidate qualifies when `Math.abs(diffDays(purchaseDate, completionDay)) <= 1`.
- Among qualifying candidates the one with the smallest distance wins; on a tie the most recently completed; none qualifying gives `null`.
- Tests with fixed dates: same day, purchase the day before completion (the household forgot to press `Ferdig handlet` until the next morning), purchase the day after completion (a second shop for the same list), two days apart is not linked, two candidates on the same distance pick the later completion, a completion at 23:30 Oslo time on the 6th is the 6th, not the 7th (the UTC pitfall ADR-0007 exists for).

Where it runs:

- `src/server/jobs/receiptProcessor.ts`, in the `done` transition: if the receipt's `shoppingListId` is `null` and `purchasedAt` is set, load the `done` lists completed within the last 3 days (a bound, not a rule; the rule is the function above) and set the link when the function returns an id.
  One `info` log line with `receiptId` and `shoppingListId` when a link is made.
- `POST /api/shopping-lists/:id/complete`: after setting `done`, link every `done` receipt with `shoppingListId = null` whose `purchasedAt` equals the completion day (Oslo); the receipt was scanned in the store before the button was pressed, which is the common order.
  The one-day tolerance is intentionally not applied here: yesterday's receipt belongs to yesterday's trip, and a receipt from tomorrow cannot exist yet.
- Neither moment touches a receipt that already has a `shoppingListId`.

## Comparison (`src/server/domain/trip.ts`, pure given its inputs)

`computeTrip({ items, lines, productNames })` where `items` are the list's items (`id`, `productId`, `name`, `quantityText`, `source`, `checked`), `lines` the `item`-kind lines of the linked receipts (`receiptId`, `productId`, `rawText`, `quantity`, `unit`), and `productNames` a `Map<number, string>` for the products involved:

- A planned item is `bought` when a line has the same `productId`, or, for an item without `productId`, when `normalizeText(line product name or rawText) === normalizeText(item.name)` (`src/shared/normalize.ts`); otherwise `notBought`.
- `unplanned` is every line whose `productId` is not among the planned items' product ids and, for lines without a product, whose normalised `rawText` matches no planned name; grouped by `productId` (or normalised text when null) with quantities summed and the unit of the first line, carrying `productId` and `name` so the client can link to the product page.
- Output `Trip`: `planned: { itemId, name, quantityText, source, checked, status: 'bought' | 'notBought' }[]` in the list's position order; `unplanned: { productId: number | null, name, quantity, unit }[]` sorted by name (`nb`); `counts: { planned, bought, notBought, unplanned }`; `receiptIds`.
- Tests: product match; name match for a manual item; a manual item spelt differently is `notBought`; two receipts on one trip; unplanned grouping sums quantities across lines; a deposit or discount line is never unplanned (the caller passes `item` lines only, and the function asserts nothing else arrives); checked-but-not-bought keeps `checked: true` and `status: 'notBought'` (the client shows it, the counts treat it as not bought).

## API (`src/shared/schemas.ts`, routes)

- `GET /api/shopping-lists/:id` (new): the list detail for any list, `404` when missing, `401` without the cookie.
- `shoppingListSchema` gains `receipts: ReceiptSummary[]` (linked receipts, newest first) and `trip: Trip | null`; `trip` is `null` while the list is `open` or has no linked receipt, so `/current` and the create/complete/reopen responses carry `receipts: [] , trip: null` today without a special case.
- `shoppingListSummarySchema` gains `tripCounts: { planned, bought, notBought, unplanned } | null`, computed for the summaries `GET /api/shopping-lists` returns (household scale, at most a few dozen lists).
- `receiptDetailSchema` gains `shoppingList: { id, weekStart } | null`; `receiptSummarySchema` gains `shoppingListId: number | null`.
- `PATCH /api/receipts/:id` accepts optional `shoppingListId: number | null`; a non-existent list gives `404` with `Handlelisten finnes ikke`; the receipt page's selector uses it.
- `GET /api/stats/summary`: `aiProposals` gains `boughtItems` (accepted items whose list item is `bought` in its list's trip), and a new `trips: { completedLists, listsWithReceipt, plannedItems, boughtItems, unplannedItems }` over all `done` lists.
- Tests per AGENTS.md: the new route's `401`; `GET /api/shopping-lists/:id` with a linked receipt returns the trip and without one returns `null`; `PATCH` link, unlink, unknown list; `complete` links a same-day `done` receipt and leaves an already-linked one alone; the processor's `done` transition links within one day and not at two; stats fields with a fixture of two lists, one with a receipt.

## Client

- New route `shopping-lists/:id` → `src/client/pages/ShoppingListDetailPage.tsx`, read-only.
  Header `Handleliste uke N` with `Fullført <date>` (`formatDateWithRelative`) and the linked receipts as links (`Kiwi, 7. sep, 412 kr`).
  For an `open` list the page redirects to `/`, where the editable list lives.
- Section `Handleturen` when `trip` is not `null`, three groups with counts in the headings: `Kjøpt som planlagt (12)`, `Ikke kjøpt (2)`, `Utenom lista (5)`.
  Planned rows show name, quantity and a small source chip (`Forslag`, `Manuell`, `AI`) so the eye can compare sources; a checked-but-not-bought row shows `Avkrysset` in grey.
  Unplanned rows show name and quantity and link to `/products/:id` when `productId` is set, which is where `Ikke foreslå` lives; no new action on this page.
  When `trip` is `null`: `Ingen kvittering er knyttet til denne listen ennå` and one sentence on how to link one from the receipt page.
- `ShoppingListPage`: the `Handleturen ble fullført kl. …` box gains a link `Se handleturen` to the detail page.
- `ReceiptsPage` history section: each row links to the detail page, and shows `12 av 14 kjøpt · 5 utenom` when `tripCounts` is set.
- `ReceiptPage`: under store and date, a `Handleliste` select with `Ingen` and the eight most recent `done` lists as `Uke 37, fullført 7. sep`; saving goes through the existing receipt `PATCH`; when linked, the header shows a link `Handleliste uke 37`.
  A note under the select: `Knyttes automatisk når datoene stemmer` so the automatic behaviour is discoverable.
- `ReceiptsPage` statistics section gains `Handleturer` (completed lists, of which with receipt, share of planned items bought, unplanned items per trip) and `AI-forslag` (proposals, proposed, accepted, bought).
  `aiProposals` has been in the API since T37 but is not rendered anywhere in the client; the T37 acceptance criterion "the statistics section shows proposals, proposed items and accepted items" was not met, and this task closes it with `bought` added.
- Query keys: `['shopping-lists', 'detail', id]`; invalidate it and `['shopping-lists']` on receipt `PATCH`, on `complete`, and when a receipt reaches `done` (the receipt page's polling already refetches the receipt; add the list keys to that invalidation).
- 44 px targets at 360 px width; Playwright walk with screenshots under `docs/reviews/screenshots/T39/`: completed list with trip, the receipt page selector, the history row, the statistics section.
- Tests: detail page groups and counts from a fixture trip; `null` trip message; source chips; receipt selector calls `PATCH` with the chosen id and with `null`; history row label; statistics labels and numbers.

## Acceptance criteria

- A list completed today and a receipt purchased today, scanned before or after `Ferdig handlet`, end up linked without any user action; a receipt two days off does not.
- The completed list shows the three groups with correct counts for a fixture of 6 planned items, 4 bought (one by name match), 2 not bought, and 3 unplanned products across two receipts.
- The receipt page can link a receipt to any of the eight most recent completed lists and unlink it; the list page reflects the change on the next load.
- Deleting a list leaves its receipts intact with no link; deleting a receipt removes it from the trip.
- Statistics show trips and AI figures including bought counts; with no completed lists the section shows zeros, not an error.
- The suggestion engine (`src/server/domain/suggestions.ts`), the proposal prompt and `proposeList.ts` are unchanged (`git diff --stat` shows no change there).
- Existing receipts and lists survive migration `0006` with their ids and `shopping_list_id = null`.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass; no eval run is needed (no prompt, model or schema change).

## Tests (summary)

Linking rule with fixed dates; comparison with product and name matches, two receipts, grouping, checked-but-not-bought; routes (`401` on the new endpoint, `GET` by id with and without receipts, `PATCH` link/unlink/404, `complete` linking same-day receipts only, processor `done` linking within one day); stats fields; migration survival and `SET NULL` on list delete; client (detail page, null message, receipt selector, history label, statistics section).

## After the merge (foreman)

The demo gets the new version once its queue is empty.
The real-data check is one completed list on the demo with the household's next receipt: the foreman records only counts (planned, bought, unplanned) and whether the automatic link fired, in `docs/reviews/T39-review.md`; item names go to Ruben directly (public repository, architecture section 11).
