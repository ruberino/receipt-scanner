# Review follow-up: T16 — Kvitteringer

Review of commits `0bc00ec`, `e12292c` and `12977ee` (T16) on `task/T16-receipt-review`, 2026-09-06.
Verdict: approved for fast-forward merge after F1 to F5.

## What was verified

All five scripts exit 0 in a clean worktree at `12977ee`.
The header edits store, date and total through `PATCH /api/receipts/:id` and shows the server message inline on failure.
All seven codes from section 6 have a Norwegian chip text, the `TOTAL_MISMATCH` and `POSSIBLE_DUPLICATE` texts are the ones from the task, and the duplicate chip links to `/receipts/{possibleDuplicateOf}`.
Item lines show raw text, quantity with unit, amount and a `ProductPicker`; discount, deposit and other lines are greyed out with a label and no picker.
`ProductPicker` debounces by 200 ms, checks the exact match through the shared `normalizeText`, offers `Opprett «…»` only without one, and handles Enter and Escape.
`Prøv matching igjen` appears for `UNMATCHED_LINES` and `MATCHING_FAILED`, `Ferdig` sends `reviewed: true`, `Slett kvittering` asks first and navigates to `/receipts`.
Every mutation invalidates receipt, receipts, products and suggestions; delete also drops the detail query.
The six screenshots show the page at 360 px with no overflow.

Decisions on the questions in the report:

- `ProductPicker` owning its mutation is accepted; it matches `ExerciseSelect` in the sibling.
- The `normalize.ts` move riding along with the feature commit is accepted as is; every commit still builds because the docs commit adds the shared copy before the server copy goes.
  Next time stage a move with `git add -A` so the rename and its import updates land in one commit.
- Verifying the "stale data" observation against the API before touching code was the right call.

## F1 — Required before merge: the header keeps the previous receipt's values after navigation

`ReceiptHeader` initialises its three inputs with `useState` from the receipt prop once.
`ReceiptPage` is the same element for every `/receipts/:id`, and `useReceipt` serves a cached receipt with `isPending: false`, so going from receipt A to receipt B through the duplicate chip and back with the browser's back button keeps the header mounted with B's store, date and total on A's page.
Pressing `Lagre` then patches A with B's header.

Steps:

1. `<ReceiptHeader key={data.id} receipt={data} />`.
2. In `ReceiptLineRow`, `<ProductPicker key={line.product?.id ?? 'none'} … />`, so a rematch or a change from another phone resets the picker text.

Test in `ReceiptPageDone.test.tsx`: render with receipt 1 (`KIWI Torshov`), change the `useReceipt` mock to receipt 2 (`REMA 1000`) and `rerender` the same tree; `Butikk` has the value `REMA 1000`.

## F2 — Required before merge: every picker searches on mount and after every mutation

`query` starts as the current product name and `useProductSearch` is enabled whenever the query is non-empty, so a receipt with 30 matched lines fires 30 `GET /api/products?q=` on load.
Every line update invalidates `['products']`, which refetches all 30 again.

Steps: give `useProductSearch` an `enabled` parameter and pass `isOpen`; the query runs only while the list is open.
Test: `useProductSearch` is last called with `enabled` false before the input is focused and true after.

## F3 — Required before merge: mutation errors outside the header are silent

`rematch.mutate()`, `handleFinish`, `handleDelete`, `selectProduct` and `createProduct` have no `onError`.
A 409 on a receipt that is not `done`, a 404 or a network failure resolves silently, and the picker shows the new name although the server kept the old product.
The client shows `message` for a 4xx; that is the rule for every mutation.

Steps:

1. Add `src/client/lib/errorMessage.ts` with `apiErrorMessage(error: unknown): string`, returning `message` for an `ApiRequestError` and `Noe gikk galt` otherwise, and use it in the header instead of the inline ternary.
2. Give every mutation an `onError` that shows it through `showToast`.
3. In the picker, also reset `query` to `currentProduct?.name ?? ''` on error.

Tests: `Ferdig` rejected with a 409 shows the server message in the toast; a rejected picker selection shows the toast and the input is back to the previous name.

## F4 — Required before merge: the total is parsed by hand instead of with `parseNok`

`Totalsum (kr)` is a `type="number"` input holding `totalOre / 100` and saving `Math.round(totalKroner * 100)`; clearing the field saves `0`.
`src/shared/money.ts` has `parseNok` for exactly this, accepting comma and dot and rejecting more than two decimals, and money parsed in two places is how the two drift.

Steps: a text input with `inputMode="decimal"`, initial value `(receipt.totalOre / 100).toFixed(2).replace('.', ',')`, parsed with `parseNok` on save; when it throws, set the inline error `Ugyldig totalsum` and do not send.
Tests: typing `43,80` sends `totalOre: 4380`; typing `abc` shows `Ugyldig totalsum` and does not call the mutation.

## F5 — Required before merge: one test covers all seven warning codes

Acceptance says a chip for every code present; the test covers two codes.
Add a test that renders each of the seven codes from section 6 and asserts the chip text is Norwegian and not the raw code, so the `?? code` fallback can never leak.

## Recommendations, no action now

- The page has no heading since the placeholder `h1` went; an `h1` with the store name orients the user and screen readers.
- Show the reviewed state, for example a `Gjennomgått` badge, and hide `Ferdig` once `reviewedAt` is set.
- Arrow keys in the picker with `aria-activedescendant` would complete the combobox.
- The toast overlaps `Slett kvittering`; bottom padding on the actions block equal to the toast height fixes it.

## Follow-up task after T16, decided by the foreman

`UNMATCHED_LINES` stays after the user has matched every line by hand, because `PATCH /api/receipt-lines/:id` does not recompute it, so the chip and `Prøv matching igjen` stay too.
After T16 merges and before T17, on its own branch: first a `docs:` commit adding to the `PATCH /api/receipt-lines/:id` row that it removes `UNMATCHED_LINES` when no item line has `product_id IS NULL`, then the server change with a route test.
The client stays code-driven and needs no change.

## Done

F1 to F5 as one or two `fix:` commits on the T16 branch.
Repeat the Playwright walk for the navigation case in F1: receipt A, duplicate chip to B, browser back, the header shows A's values.
Then fast-forward merge and send the hash.
