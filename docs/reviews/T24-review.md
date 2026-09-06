# Review follow-up: T24 — Kvitteringer

Review of commits `ca2e2e7`, `13ab48d` and `af25ee5` (T24) on `task/T24-upload-then-scan`, 2026-09-06.
Verdict: not approved; F1 destroys data and blocks the merge on its own, F2 to F4 are required as well.

## What was verified

All five scripts exit 0 in a clean worktree at `af25ee5`; 377 tests pass.
`POST /api/receipts` stores the receipt as `uploaded`, replies `201` and enqueues nothing; `POST /api/receipts/:id/scan` moves `uploaded` and `failed` to `pending`, answers `409` otherwise, and `requeueUnfinished()` leaves `uploaded` alone; each has its test and its 401 test.
The scan page queues files in selection order, downscales and uploads them one at a time with the five per-file states, keeps going after a `409`, and offers `Skann (1)` or `Skann alle (n)` counted from `GET /api/receipts`.
`ReceiptPage` has the `uploaded` view with `Skann` and `Slett kvittering`, `useScanReceipt` is shared, the badge says `Lastet opp`.
The docs commit matched the plan, and the section 4 correction and the Job runner row were right.

## F1 — Required before merge, blocker: the migration deletes every receipt line and image

Probe in a clean worktree at `af25ee5`: migrate with the `0000-only` fixture, insert one receipt, one `receipt_lines` row and one `receipt_images` row, then run the current migrations.
Before: 1 receipt, 1 line, 1 image.
After: 1 receipt, 0 lines, 0 images, and `PRAGMA foreign_key_check` reports nothing because the children are simply gone.

Cause: drizzle's migrator runs every statement between one `BEGIN` and one `COMMIT` (`sqlite-core/dialect.js`, `migrate`), and SQLite ignores `PRAGMA foreign_keys` inside a transaction, so the generated `PRAGMA foreign_keys=OFF` does nothing.
`openDatabase` has `foreign_keys = ON`, so `DROP TABLE receipts` runs its implicit `DELETE FROM receipts`, and `receipt_lines.receipt_id` and `receipt_images.receipt_id` are `ON DELETE CASCADE`.
Deployed to Render this would have wiped every scanned receipt's lines and image on boot.
The T24 migration test did not catch it because it inserted a receipt and nothing that references it.

Steps, in this order:

1. Reproduce first: extend the existing migration test so the receipt has one line and one image before the second `migrate()`, and assert both survive; it must fail on `af25ee5`.
2. In `runMigrations`, turn foreign keys off before `migrate()` and on again after, outside the transaction, using the raw `sqlite` handle (`OpenedDatabase` has it, so `runMigrations` takes the opened database instead of only `db`), then run `PRAGMA foreign_key_check` and throw if it returns rows.
3. Add a sentence to the migrations part of `docs/architecture.md`: "Migrations run with `foreign_keys` off and `PRAGMA foreign_key_check` after, because drizzle's SQLite table recreates would otherwise cascade-delete child rows."
4. Keep the generated migration file as it is; the pragma lines in it are harmless.

This is the one class of bug a household app cannot afford; from now on every table-recreate migration needs the child-row test.

## F2 — Required before merge: `Skann alle` can be tapped while files are still uploading

The button appears as soon as one receipt is `uploaded`, while the queue may still be downscaling or uploading the next file.
Tapping it navigates away; the queue lives in refs on the unmounted page, so the remaining files upload unseen and the user has no list to come back to.

Steps: disable the button while any entry is `preparing` or `uploading`, with the label unchanged so the count stays visible.
Test: with one uploaded receipt and one entry still uploading, the button is disabled; once the entry is `uploaded`, it is enabled.

## F3 — Required before merge: `Prøv igjen` fails silently

`scan.mutate(id)` in the failed view has no `onError`; a `409` or a network failure shows nothing, the same gap T16's F3 closed for the done state.
Steps: `onError` with `showToast(apiErrorMessage(error))`, and a test that a rejected scan shows the message in the toast.

## F4 — Required before merge: ADR-0006 still documents `/retry`

`docs/adr/0006-in-process-job-runner-with-persisted-status.md` line 20 describes `POST /api/receipts/:id/retry` for `failed` receipts.
Amend the bullet to `POST /api/receipts/:id/scan`, allowed for `uploaded` and `failed`, and note the T24 date; ADRs are normative and the code now contradicts this one.

## Recommendations, no action now

- `aria-live="polite"` on the upload list, so the per-file states are announced; the old progress bar had `role="progressbar"` and nothing replaced it for screen readers.
- Camera photos on iOS are all named `image.jpg`; showing `Bilde 1`, `Bilde 2` with a running number reads better than five identical names.
- Landing on `/receipts` after `Skann alle` shows the T14 placeholder until T19; T19 moves up to right after T24 for that reason, see below.

## Order after T24

T19 (receipts list, PWA manifest, mobile polish) comes next, then T26, then T25, then T17 and T18.
The list is where the uploaded receipts become visible, and Ruben tests from his phone now.

## Done

F1 as its own `fix:` commit with the failing-then-passing test in the body, F2 to F4 as one or two commits, all on the T24 branch.
Run the five scripts, then send the hashes; do not merge before the go-ahead on F1 is recorded here.
