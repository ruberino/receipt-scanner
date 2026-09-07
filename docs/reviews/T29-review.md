# Review: T29 — Kvitteringer

Review of pull request #6, `task/T29-edit-lines`, commits `738eb71` (docs), `d42e29c` (implementation) and `111ea7a` (F1 fix, review file, screenshots), 2026-09-07.
Verdict at first pass, read from the local branch before the pull request was opened: one required item (F1); everything else in the plan is met.
Second pass on `111ea7a`: F1 is done; the screenshots showed one small UI item (F2).
The go-ahead is recorded below once F2 is in.

## What was verified

Server: the third `PATCH` body is a `.partial().strict()` object with a non-empty refinement, appended to the existing union, so the two product bodies are untouched; the route tells the bodies apart by the presence of `productId` or `newProductName`.
`recomputeLineWarnings` strips `TOTAL_MISMATCH` and `UNMATCHED_LINES`, recomputes both from the current lines (`other` excluded from the sum, `null` total counts as a mismatch, exactly as `PATCH /api/receipts/:id` does), leaves every other warning alone, and bumps `updated_at`, all inside the one transaction with the line update or delete.
`computeLineSum` moved to `src/server/domain/receiptWarnings.ts` and the existing product-body path now uses the shared `hasUnmatchedItemLine`; no behaviour change there.
`409` uses the same Norwegian message as the receipt header route; `DELETE` gives `204`, `404`, `409`, leaves `line_no` as is.
Client: edit mode prefilled from the line in kroner with a decimal comma, `parseNok` accepts the negative and comma forms `krText` produces, only changed fields are sent, `Ugyldig beløp` is inline with `role="alert"`, the delete sits behind `window.confirm` like every other delete in the app, toasts and `apiErrorMessage` as planned, all targets `min-h-11`.
Docs: architecture 7.6, the two API rows and the page row, tasks.md entry; the plan file is unchanged.
Tests cover 401 and 404 for both routes, 409, the empty body, both warning recomputes in both directions, other warnings left alone, the kind transitions, and on the client the prefill, changed-fields-only, invalid amount, success and error toasts, cancel, confirmed and dismissed delete.

## Required before merge

- F1. The sign rule must hold for the resulting line, not only for an amount sent in the same request.
  Today `PATCH { kind: 'item' }` on a `discount` line at −1000 øre is accepted and produces an item with a negative amount, which the acceptance criterion "an item with a negative one is rejected" forbids and which would push a negative purchase into the product statistics; the test named "does not check the amount sign when only kind changes" pins the wrong behaviour.
  Fix: check `body.totalOre ?? line.totalOre` against `body.kind ?? line.kind`, with the existing two messages; turn that test around so `{ kind: 'other' }` on a −100 discount gives `400` with the "negativt" message, and add the passing sibling `{ kind: 'other', totalOre: 0 }`.
  The row's `Lagre` then shows the server message in the toast when the user flips a negative line to `Vare`, which is the intended nudge to delete the line instead.
  Done in `111ea7a`, verified: the check runs whenever `totalOre` or `kind` is in the request, against the resulting line; the test is turned around and the passing sibling added.
- F2. `ReceiptLineRow.tsx`: on a non-item line the whole row has `opacity-50`, so the `Rediger` button is faded too and reads as disabled (screenshot `01-receipt-with-warnings.png`, the `Tilbud` row).
  Fade the text column only and leave the button at full opacity; no test change needed beyond the existing render test still passing.

## Noted, no action

- `quantity` and `unitPriceOre` are accepted by the API but not editable in the row, as the plan's client section specified; the picker path stays the only way to set a product.
- Deleting a line leaves any user alias created for it in place; aliases belong to products, not lines, so this is right.
