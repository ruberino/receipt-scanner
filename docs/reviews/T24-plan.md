# T24 plan — Kvitteringer: upload and scan as two operations, several photos at a time

Foreman's task definition, 2026-09-06, on Ruben's request: "laste opp flere kvitteringer om gangen" and "opplast og scan blir 2 operasjoner".
Order of work: finish the T16 fixes, then T24, then T25 (the `UNMATCHED_LINES` recompute from the T16 review), then T17.
Branch `task/T24-upload-then-scan`.
Land the docs commit first; the wording below is approved, adjust grammar only, not meaning.

## The change in one paragraph

Uploading stores the photo and creates a receipt in a new status `uploaded`; nothing is sent to Kimi.
Scanning is a separate action, `POST /api/receipts/:id/scan`, which moves an `uploaded` or `failed` receipt to `pending` and enqueues it; it replaces `POST /api/receipts/:id/retry`.
The scan page accepts several photos at once from the library, uploads them one after the other with per-file progress, and offers `Skann alle (n)` for every uploaded receipt.

## Docs commit: `docs/architecture.md`

1. Section 1, the goal line "Scan a receipt from the phone camera…": replace with "Upload one or more receipt photos from the camera or the photo library, start the scan as a separate step, and follow processing status."
2. Section 2, scenario 1: "Open the app, tap «Skann», take a photo; it uploads at once. Tap «Skann (1)». The app shows «Leser kvittering…» for 10–40 seconds, then the review screen…" and keep the rest.
   Add scenario 4: "Catching up. Pick six receipt photos from the library; they upload one after the other. Tap «Skann alle (6)» and open the receipts list, where the six move from «Lastet opp» through «Leser…» to «Klar»."
3. Section 5 flow: `POST /api/receipts -> store image + receipt(status=uploaded) -> 201` and a new line `POST /api/receipts/:id/scan -> status=pending -> 202 -> enqueue`; the poll line is unchanged.
4. Section 6, `receipts.status` CHECK: `('uploaded','pending','processing','done','failed')`.
5. Section 7, upload steps: step 5 becomes "Insert `receipts` (`status = 'uploaded'`) and `receipt_images` in one transaction, reply `201 { id }`; nothing is enqueued."
   Replace the retry bullet with "`POST /api/receipts/:id/scan` sets `pending` and enqueues; allowed when `uploaded` or `failed`, else `409`."
   `requeueUnfinished()` stays as it is; `uploaded` receipts wait for the user.
6. Shared types: `type ReceiptStatus = 'uploaded' | 'pending' | 'processing' | 'done' | 'failed'`.
7. API table: `POST /api/receipts` replies `201 { id }`; the retry row becomes `POST /api/receipts/:id/scan` | — | `202 ReceiptSummary` | Only when `uploaded` or `failed`, else `409`.
8. Section 10 routes:
   - `/scan` ScanPage: "«Ta bilde» (`<input type="file" accept="image/*" capture="environment">`, one photo) and «Velg fra bilder» (same input without `capture`, `multiple`). Every selected file is downscaled and uploaded at once, one after the other in selection order, in a list with per-file state: «Laster opp … 45 %», «Lastet opp», «Allerede skannet» with a link to the existing receipt, or «Feilet: {message}». Below the list, «Skann (1)» or «Skann alle (n)» for every receipt with status `uploaded`; it calls scan for each and navigates to `/receipts/:id` when n is 1, else to `/receipts`."
   - `/receipts/:id` ReceiptPage: add "While `uploaded`: image thumbnail, «Skann» and «Slett kvittering»." and change the failed state to "«Prøv igjen», which calls scan".
   - `/receipts` ReceiptsPage (T19): add "«Skann» on each `uploaded` row and «Skann alle (n)» above the list."
   - Behaviour rules: add "Uploads run one at a time in selection order; a `409` on one file does not stop the others." and "`ReceiptStatusBadge` shows `uploaded` as «Lastet opp»."
9. Section 12 tests row for the client: add "ScanPage multi-upload".

## Docs commit: `docs/tasks.md`

Append after T23:

```
## T24 — Upload and scan as two operations, several photos at a time

Goal: upload many receipt photos quickly, then scan them as a separate step.

Files: `src/server/db/schema.ts` and a migration for the `status` check, `src/server/routes/receipts.ts` (`201` on upload, `scan` replaces `retry`), `src/shared/schemas.ts`, `src/client/pages/ScanPage.tsx`, `src/client/pages/ReceiptPage.tsx` (`uploaded` state, `Prøv igjen` calls scan), `src/client/components/ReceiptStatusBadge.tsx`, `src/client/api/queries.ts` (`useScanReceipt`, `useReceipts` if missing), tests for all of it.

Steps:

1. Docs as in `docs/reviews/T24-plan.md`, own commit.
2. Server: status `uploaded`, migration, `POST /api/receipts` replies `201` and does not enqueue, `POST /api/receipts/:id/scan` for `uploaded` and `failed`, `retry` removed.
3. Client: ScanPage list upload with per-file state, `Skann alle (n)`, ReceiptPage `uploaded` state, badge text, `Prøv igjen` through scan.
4. Playwright walk with three photos, screenshots under `docs/reviews/screenshots/T24/`.

Acceptance criteria:

- Picking three photos uploads all three one after the other, each ending as «Lastet opp»; three receipts have status `uploaded` and the processor has not been called.
- A photo that already exists shows «Allerede skannet» with a link and the remaining files still upload.
- «Skann alle (3)» moves the three to `pending` and they reach `done` or `failed` without further input.
- «Prøv igjen» on a `failed` receipt and «Skann» on an `uploaded` one both call `POST /api/receipts/:id/scan`; `done`, `pending` and `processing` answer `409`.
- A server restart does not scan `uploaded` receipts.

Tests: scan route (401, `uploaded` → 202 `pending`, `failed` → 202, `done` → 409), upload returns 201 without enqueue, requeue ignores `uploaded`, ScanPage with three mocked files (order, per-file state, one 409), `Skann alle` calls scan per id and navigates, ReceiptPage `uploaded` state, badge label.

## T25 — Recompute `UNMATCHED_LINES` after a manual match

Goal: the unmatched warning disappears once every item line has a product.

Files: `docs/architecture.md` PATCH receipt-lines row, `src/server/routes/receiptLines.ts`, its tests.

Steps:

1. Docs row: `PATCH /api/receipt-lines/:id` removes `UNMATCHED_LINES` from the receipt when no item line has `product_id IS NULL`; `MATCHING_FAILED` is left alone.
2. Implement inside the existing transaction; return the line as before.

Acceptance criteria:

- Matching the last unmatched line removes `UNMATCHED_LINES` from `GET /api/receipts/:id`; matching one of two leaves it.
```

Also add one bullet to T19: "«Skann» on each `uploaded` row and «Skann alle (n)» above the list, calling `POST /api/receipts/:id/scan` per receipt."

## Implementation notes

- The status CHECK cannot be altered in SQLite; let `drizzle-kit generate` produce the table recreate, and verify with a test that a database migrated from `0000` with existing `done` rows keeps them.
- `201` for upload is the correct code now that nothing is accepted for processing; update `useUploadReceipt` tests.
- The scan page does not preview before upload; the OS camera UI has its own retake step, and a library pick of many files cannot be confirmed one by one.
- Keep `downscaleImage` per file before each upload; the list item shows the downscale as «Forbereder …».
- `Skann alle (n)` counts `uploaded` receipts from `GET /api/receipts`, not only this session's uploads.
- Duplicate detection on sha256 stays at upload; `POSSIBLE_DUPLICATE` stays at scan.
- Every mutation invalidates `['receipts']` and the affected `['receipt', id]`.

## Gate

Send the hashes before merging; the walk with three photos and the screenshots are part of the review.
