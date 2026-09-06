# Review follow-up: T06 — Kvitteringer

Review of commit `7ede305` (T06) on `task/T06-receipt-upload`, 2026-09-06.
Verdict: approved for fast-forward merge; F1 is recommended and may follow with the next server task.

## What was verified

All five scripts exit 0 on the branch; 135 tests pass; `sharp` is imported only by `src/server/lib/images.ts`, and ESLint rejects it elsewhere.
`normaliseImage` follows ADR-0005 and section 7.1: format check for JPEG, PNG and WebP with a Norwegian `400`, EXIF rotation, long edge at most 2000 px without enlarging, JPEG quality 85, dimensions read from the output, sha256 of the result.
`@fastify/multipart` is registered with `limits.fileSize = config.maxUploadBytes` and `files: 1`; a file over the limit surfaces as `413 PAYLOAD_TOO_LARGE` through the general 4xx mapping, with a test at `MAX_UPLOAD_BYTES=1000`.
The upload handler normalises, checks the sha256, inserts `receipts` (`pending`) and `receipt_images` in one `app.sqlite.transaction`, calls the `enqueue` stub and replies `202 { id }`; the duplicate case returns `409 CONFLICT` with `details.existingReceiptId`.
`GET /api/receipts/:id/image` returns the stored JPEG with `Cache-Control: private, max-age=86400` and `404` when missing.
Every acceptance bullet has a test through `app.inject()` with a real `FormData` body, both routes have their 401 case, and the fixtures are 1.2 KB, 965 B and 27 B.
`receiptSummarySchema` matches the section 9 shape.

## F1 — Recommended: make the duplicate check race-safe

The sha256 lookup runs before the transaction, so two identical uploads arriving together would both pass the check and the second insert would fail on the unique index with a `500 INTERNAL`.

Steps: catch the unique violation on the `receipt_images` insert inside the transaction and throw the same `ConflictError` with the existing receipt id; add `isUniqueViolation(error)` to `src/server/db/client.ts` as the sibling app did, so the `better-sqlite3` error class stays under `src/server/db/`.
Test it by inserting a `receipt_images` row with the fixture's sha256 directly through `app.db` and then uploading the fixture.

Acceptance: the upload returns `409` with the pre-inserted receipt id, and `grep -rl "from 'better-sqlite3'" src/server` lists only files under `src/server/db/`.

## Done

Fast-forward merge now; F1 as its own `fix:` commit the next time a server task touches `routes/receipts.ts`.
