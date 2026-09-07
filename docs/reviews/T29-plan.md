# T29 plan — Kvitteringer: correct a line's amount and kind, delete a line

Foreman's task definition, 2026-09-07, approved by Ruben after receipt 8 showed a wrong discount line with no way to fix it in the review UI.
Order: after T28 merges.
Branch `task/T29-edit-lines`, pull request per AGENTS.md, docs commit first.

## The change in one paragraph

The review page lets the user correct what the model got wrong on a line, not only which product it is: the amount, the kind (item, discount, deposit, other) and, when a line should not exist, delete it.
Every such change recomputes the receipt's `TOTAL_MISMATCH` and `UNMATCHED_LINES` warnings the same way `PATCH /api/receipts/:id` and T25 already do, so a corrected receipt loses its false warning without a rescan.

## API

- `PATCH /api/receipt-lines/:id` keeps its two product bodies and gains a third: `{ totalOre?, quantity?, unitPriceOre?, kind? }` with at least one field, `.strict()`, as a third member of the existing union.
  `totalOre` is an integer, at most 0 for `discount`, at least 0 for the other kinds, checked against the resulting kind; `quantity` positive; `unitPriceOre` integer or null.
  Changing `kind` away from `item` clears `product_id` and `match_source` and creates no alias; changing it to `item` leaves `product_id` null, so the line is unmatched until the picker is used.
  Only when the receipt is `done`, else `409` with the existing message.
- `DELETE /api/receipt-lines/:id`: `204`, `404` when missing, only when the receipt is `done`; `line_no` of the remaining lines is left as is.
- After either call, inside the same transaction: recompute `TOTAL_MISMATCH` (`|sum of totalOre over all lines − total_ore| > 100`) and `UNMATCHED_LINES` (any item line with `product_id IS NULL`) on the receipt, leave every other warning alone, bump `updated_at`.
- Response of the `PATCH` stays the `ReceiptLine`; the client refetches the receipt for the warnings.

## Client

- `ReceiptLineRow` gets an edit mode opened from a `Rediger` button (44 px): amount as a text field with `inputMode="decimal"` prefilled with the current amount as kroner, parsed with `parseNok` (`Ugyldig beløp` inline on failure, nothing sent), kind as a select with `Vare`, `Rabatt`, `Pant`, `Annet`, and `Slett linje` behind a confirmation.
  `Lagre` sends only the changed fields; errors go through `apiErrorMessage` to the toast; success shows `Linjen er oppdatert` or `Linjen er slettet`.
- New hooks `useUpdateReceiptLineFields(receiptId)` and `useDeleteReceiptLine(receiptId)` in `queries.ts`, invalidating through `invalidateReceiptRelated`.
- The product picker stays as it is on item lines; non-item lines show the kind label and the same `Rediger` button.

## Docs commit

- `docs/architecture.md`: the `PATCH /api/receipt-lines/:id` row gains the third body and the recompute sentence; a new `DELETE /api/receipt-lines/:id` row; the `/receipts/:id` row in section 10 gains "each line's amount and kind can be corrected and a line deleted; warnings recompute".
- `docs/tasks.md`, append:

```
## T29 — Correct a line's amount and kind, delete a line

Goal: a wrong line from the model can be fixed or removed in the review, and the false warning goes away.

Files: `src/shared/schemas.ts`, `src/server/routes/receiptLines.ts`, `src/client/components/ReceiptLineRow.tsx`, `src/client/api/queries.ts`, tests.

Steps: see `docs/reviews/T29-plan.md`.

Acceptance criteria:

- Deleting the wrong discount line on a receipt whose lines then sum to the total removes `TOTAL_MISMATCH` without a rescan.
- Changing an item line to `other` clears its product and, if it was the last unmatched item line, removes `UNMATCHED_LINES`.
- Editing an amount to a value that breaks the sum adds `TOTAL_MISMATCH`.
- A discount with a positive amount, or an item with a negative one, is rejected with a Norwegian message.
- Every action is possible with 44 px targets at 360 px width; Playwright walk with screenshots under `docs/reviews/screenshots/T29/`.

Tests: route tests for the three bodies, delete, both warning recomputes, the kind and sign rules, 409 when not done, 401; client tests for edit, invalid amount, delete after confirmation, error toast.
```

## Gate

Pull request, send the number; merge after the go-ahead is recorded here.
Real-data check after merge: receipt 8 in the demo loses its `TOTAL_MISMATCH` when the `Tilbud (-10,00 kr)` line is deleted.
