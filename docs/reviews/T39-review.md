# Review: T39 — Kvitteringer

Review of pull request #20, commits `fda3478` (docs) and `314a26c` (implementation) on `task/T39-shopping-trip`, 2026-09-08.
Verdict at first pass: two required items (F1, F2), both small; the data model, the linking rule, the routes and the client follow the plan and the tests are thorough.
Second pass on `2f5c70e`: F1 and F2 are done; approved, see the go-ahead at the end.

## What was verified

Data: migration `0006` is a plain `ADD COLUMN ... REFERENCES shopping_lists(id) ON DELETE SET NULL` plus the index; the snapshot carries `onDelete: set null`; the migration test shows an existing receipt surviving with `null` and a list deletion nulling the link.
The hand edit to the generated SQL (drizzle-kit dropped the `ON DELETE` clause) is right and is what the schema and the snapshot both declare.
Linking rule: `findTripList` is pure, compares Oslo civil dates, one-day tolerance, closest wins, latest completion breaks a tie; eight tests including the 23:30 Oslo case.
Where it runs: the processor's `done` transition links only when nothing has linked the receipt before and `purchasedAt` is set, with a three-day candidate window and one `info` line; `complete` links same-day unlinked `done` receipts inside the transaction, no tolerance, as the plan asked.
Comparison: `computeTrip` is pure; product-id match, name match through `normalizeText`, unplanned grouping with summed quantities, `nb` sort, `receiptIds`; ten tests.
Routes: `GET /api/shopping-lists/:id` with `401`/`404`; `receipts` and `trip` on the detail, `trip: null` for open lists and for lists without a receipt; `tripCounts` on summaries; `PATCH /api/receipts/:id` links, unlinks, `404 Handlelisten finnes ikke`, leaves the field alone when absent; stats `trips` and `aiProposals.boughtItems`; the plan's fixture (6 planned, 4 bought with one by name, 2 not bought, 3 unplanned across two receipts) is a test.
Client: the detail page with the three groups, source chips, `Avkrysset`, receipt links and the null-trip message, redirect for an open list; `Se handleturen` on the completed box; history rows link and show `12 av 14 kjøpt · 5 utenom`; the receipt page selector with `Ingen` and the eight most recent completed lists, the header link, and `Knyttes automatisk når datoene stemmer`; the statistics section renders `Handleturer` and `AI-forslag`, which closes the T37 gap; invalidation of the shopping-list queries on receipt corrections, on `complete` and on the `done` transition.
Untouched, checked with `git diff --stat c26d27b..314a26c`: `suggestions.ts`, `proposeList.ts`, `proposeList.prompt.ts`.
Docs: ADR-0018, architecture sections 5, 6, 9 and 10 with the history-row correction folded in, the ADR index, the T39 entry in `docs/tasks.md`, three screenshots.
All five scripts exit 0 in a clean worktree at `314a26c`, 754 tests, Vitest at two workers; CI is green on both jobs.

## Required before merge

- F1. A planned item with a product is `notBought` when the receipt line for it was not matched to a product but reads the same, while the same line is not `unplanned` either, so the item disappears from both sides.
  Verified at `314a26c`: item `{ productId: 7, name: 'Melk' }` against line `{ productId: null, rawText: 'MELK' }` gives `planned: ['notBought'], unplanned: 0`.
  The unplanned rule already consumes a productless line by normalised name against every planned item's name; the bought rule only does the name comparison for items without a product.
  This is the common shape after a `MATCHING_FAILED` receipt (matching is best effort, ADR-0004), where every planned item would show as not bought and nothing as unplanned.
  Fix: an item is `bought` when a line shares its `productId` or when a line's display name normalises to the item's name, for items with and without a product; the doc comment on `computeTrip` says so.
  Test: the case above comes back `bought` with `unplanned: 0`.
- F2. The statistics screenshot `03-history-row.png` shows `AI-forslag` with `Forslag 0`, `Foreslåtte varer 0`, `Godtatte varer 0` and `Kjøpte varer 1`, a state the app cannot produce, because the Playwright fixture inserts a `source = 'ai'` item without a proposal.
  Fix: the fixture stores one proposal with that item accepted (or the item is inserted through `accept`), and the screenshot is retaken so the four numbers are consistent; no product change.

## Noted, no action

- `src/server/routes/stats.ts` imports `computeTripForList` from `src/server/routes/shoppingLists.ts`, a route module lending a loader to another route module.
  It works and is tested; a `domain/tripQueries.ts` home for the DB-backed loaders would read better if a third caller appears.
- The receipt page selector lists the eight most recent completed lists; a receipt linked to an older list shows `Ingen` in the select while the `Handleliste uke N` link above it still says the truth.
  Rare and self-explaining; left alone.
- The history summaries compute a trip per list on every `GET /api/shopping-lists`, a few queries per list; fine at household scale and consistent with the read-side computation the ADR chose.
- The drizzle-kit `ON DELETE` omission is worth an upstream issue if it reproduces on a fresh `generate`; not this repository's concern beyond the hand edit already made.

## Go-ahead, 2026-09-08

F1 and F2 verified at `2f5c70e`: an item with a product is `bought` when a line shares its product or reads the same after `normalizeText` (the `Melk`/`MELK` case now gives `bought` with `unplanned: 0`, checked empirically and as a test), and the statistics screenshot shows one proposal, one proposed, one accepted and one bought item after the Playwright seed stores the proposal the way `accept` does.
All five scripts exit 0 in a clean worktree at `2f5c70e`, 755 tests, Vitest at two workers; CI is green on both jobs.
Approved: re-read this file, commit it on the branch, push, wait for green, merge with `gh pr merge --rebase --delete-branch`, `git pull --ff-only`.
After the merge the foreman updates the demo once its scan queue is empty and runs the real-data check described in the plan.
The Kvitteringer queue is empty after this task.

## Real-data check, 2026-09-08

Run by the foreman on the demo at `3f6bc7b` against the household database, after a backup and with an empty scan queue; migration `0006` applied at start-up with no error lines and `PRAGMA foreign_key_check` clean.
The automatic link could not fire on existing data: the only completed list is from 2026-09-07 and empty, and no receipt is dated 7 or 8 September, so the linking rule waits for the household's next real trip.
What was checked by hand through the API, counts only:

| Step | Result |
| --- | --- |
| `PATCH /api/receipts/3 { shoppingListId: 1 }` | `200`, detail carries `shoppingList { id: 1 }` |
| `GET /api/shopping-lists/1` | one linked receipt, `trip.counts` planned 0, bought 0, notBought 0, unplanned 3 |
| `GET /api/stats/summary` | `trips` completedLists 1, listsWithReceipt 1, unplannedItems 3; `aiProposals` all zero (the demo's proposals went with their temporary lists) |
| `PATCH /api/receipts/3 { shoppingListId: null }` | `200`, list detail back to no receipts and `trip: null` |
| `PATCH /api/receipts/3 { shoppingListId: 999 }` | `404` |

Judgement: the plumbing works on real rows, the unplanned grouping collapsed the receipt's four item lines into three products as designed, and the unlink restores the previous state.
The first real trip (a list completed and its receipt scanned the same day) is the check that matters, and its counts go into this file when it happens; item names stay out of git (architecture section 11).
