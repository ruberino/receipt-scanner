# ADR-0018: A receipt belongs to a list; the outcome is computed, not stored

- Status: Accepted
- Date: 2026-09-07

## Context

The list is the week's shopping (T36) and the AI proposal is measured by acceptance (ADR-0016), but accepted is not bought.
The two halves of the app never meet: the list proposes, the household shops, the receipt is read, and nothing shows whether the plan was followed.
The receipts already hold the truth, line by line, matched to the same products the list items point at.
Ruben accepted the foreman's proposal to close this loop: what was actually bought, next to what was planned and what the AI proposed.

## Decision

- `receipts.shopping_list_id` (nullable, `ON DELETE SET NULL`) is the only new persisted fact.
  Several receipts may belong to one list (two shops on one trip); a receipt belongs to at most one list.
- The link is made automatically at two moments — a receipt reaching `done`, and a list being completed — by one pure rule, `findTripList` (`src/server/domain/tripLink.ts`): the receipt's purchase date and the list's completion day (both civil dates in Oslo, ADR-0007) within one day of each other, closest distance wins, most recent completion breaks a tie.
  The user can override the link on the receipt page at any time.
- The comparison (`Trip`, `src/server/domain/trip.ts`) is a pure function of the list's items and the linked receipts' item lines, computed on every read.
  Nothing about the outcome is written back to the list, the products or either engine in this task: a planned item is `bought`, `notBought`, or a receipt line is `unplanned`, by product id or, failing that, by `normalizeText` on the name.
- The statistics section adds purchase counts (`trips`) next to the acceptance counts (`aiProposals`), so both engines are judged against the same receipts.
- The rule engine (ADR-0008) and the proposal prompt (ADR-0016) are untouched: this task measures, a later task may act on what the numbers say.

## Consequences

- A re-read receipt (`done` again) may re-link automatically after the user unlinked it, if the dates still qualify — an accepted trade-off, noted on the receipt page's selector, not silently surprising since the user just used that same selector.
- A list deleted by the user leaves its receipts intact with `shopping_list_id = null`; a receipt deleted removes it from the trip, since the trip is computed from whichever receipts still point at the list.
- Matching a manual or AI item without a `productId` to a receipt line goes through `normalizeText` on names, which will miss spelling variants (e.g. a plural the model wrote differently from what the receipt says); such an item then counts as `notBought`, visible in the UI so the user can fix the product match on the receipt, after which the trip updates on the next read — no separate correction flow is needed.
- Computing the trip on every read costs one query for the linked receipts' lines per list detail view, at household scale (at most a handful of receipts per list); no caching, matching every other read-side computation in this codebase (suggestions, product stats).

## Alternatives considered

- Storing the trip outcome per item: a second source of truth that goes stale the moment a line is re-matched or a receipt is re-read; rejected in favour of computing it fresh every time, the same choice already made for suggestions (ADR-0008) and product stats.
- A `shopping_trips` table between lists and receipts: rejected — the list already is the trip (T36's weekly frame), and a receipt-to-list foreign key says everything a join table would, with one fewer table to keep consistent.
- Feeding the outcome straight into the suggestion engine: rejected — there is no data yet to say what a good rule would even look like; ADR-0008 stays as it is until the trips collected here show a pattern worth acting on.
