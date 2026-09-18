# T41 plan — Kvitteringer: a duplicate warning that points at nothing

Foreman's task definition, 2026-09-18, out of the follow-up recorded in `docs/reviews/design-subtractive-review.md`.
Ruben has not asked for this one; it came out of the design review's screenshot of the household's own data, and it goes first because it is small and because the text on the screen is wrong.
Order: after the subtractive design pass merges. Branch `task/T41-duplicate-warning`, pull request per AGENTS.md, this plan as the first (docs) commit.

## The bug

`after-50-kvittering-varsel.png` in `docs/reviews/screenshots/design-subtractive/` shows a receipt whose blush block reads `Ligner på kvittering #null, er den skannet to ganger?`.

The path: the processor finds a duplicate, writes `POSSIBLE_DUPLICATE` into `warnings_json` and the other receipt's id into `possible_duplicate_of`, both in one transaction (`src/server/jobs/receiptProcessor.ts`).
`possible_duplicate_of` is `ON DELETE SET NULL` (`src/server/db/schema.ts`, migration `0000`), so deleting the receipt it points at — which is exactly what the household does with a duplicate — clears the pointer and leaves the warning behind.
`WARNING_LABELS.POSSIBLE_DUPLICATE` in `src/client/pages/ReceiptPage.tsx` then interpolates the null.
The warning also still counts in `n varsel` on the receipts list, so a receipt keeps announcing a problem that has been dealt with.

The label code is identical on `main` before the design pass; the pass only moved it from a small yellow pill into the blush block, where it is now the loudest thing on the page.

## Decision

Two parts, both in `src/server/routes/receipts.ts`. The client is not touched.

1. **The pointer is the warning.** `toReceiptSummary` drops `POSSIBLE_DUPLICATE` from `warnings` when `possibleDuplicateOf` is null.
   Every API path that returns a receipt goes through that one function — the list, the detail (`buildReceiptDetail` spreads it), the scan response and the linked receipts on a shopping list — so one guard covers all of them, and it covers the rows already sitting in the household and demo databases without a migration.
   No other warning gets this treatment: this is the only one that carries a foreign key.
2. **Stored state does not rot.** The `DELETE /api/receipts/:id` handler removes `POSSIBLE_DUPLICATE` from the `warnings_json` of every receipt whose `possible_duplicate_of` is the receipt being deleted, in the same transaction as the delete and *before* it, since afterwards SQLite has already nulled the pointer and the rows can no longer be found.
   `updated_at` on those rows moves with the change.

Part 1 is what makes the screen right today and for every old row; part 2 keeps the database honest so the guard is a safety net rather than the mechanism. Do both.

## Not in this task

- The wording of the label, the blush block and anything else visual. ADR-0020 decided how it looks; this task decides when it exists.
- The duplicate heuristic itself (`findPossibleDuplicate`) and `TOTAL_MISMATCH` or any other warning.
- A migration that rewrites `warnings_json` in place. Part 1 makes it unnecessary, and a migration that edits JSON in every receipt row is a larger risk than the bug.

## Files

`src/server/routes/receipts.ts`, `docs/architecture.md` (the `DELETE /api/receipts/:id` row in section 9, and the sentence in section 6 about what `warnings_json` holds, so the read-time rule is written down where the warning list is described), `test/server/receipts.test.ts`.

## Acceptance criteria

- A receipt with `POSSIBLE_DUPLICATE` in `warnings_json` and `possible_duplicate_of` null returns `warnings` without that code from `GET /api/receipts`, `GET /api/receipts/:id`, `POST /api/receipts/:id/scan` and the linked receipts of `GET /api/shopping-lists/:id`; every other warning on the row survives untouched.
- With the pointer set, the warning is returned exactly as today, and the detail still carries `possibleDuplicateOf` so the client keeps linking to the other receipt.
- Scanning two copies of the same receipt and then deleting one leaves the survivor with no `POSSIBLE_DUPLICATE` in the database, not merely hidden at read time, and its `n varsel` count drops by one.
- Deleting a receipt nothing points at, and deleting one that points at another (the pointer's own row going away), both still return `204` and leave the other receipts' warnings alone.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run format:check` pass; no extraction eval (no prompt, model or schema change).

## Tests

`test/server/receipts.test.ts`: the guard in all four response shapes with a null pointer; the warning intact with the pointer set; other warnings on the same row untouched; the delete path clearing the survivor's stored `warnings_json` (read the row back from the database, not through the API, so part 2 is proven separately from part 1); delete with no referring row; delete of a receipt that itself points at another; the existing `401` test unchanged.
