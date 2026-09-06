# Review follow-up: T08 — Kvitteringer

Review of commit `6a011d8` (T08) on `task/T08-job-runner`, 2026-09-06.
Verdict: approved for fast-forward merge, no follow-up items; two notes shape T09.

## What was verified

All five scripts exit 0 on the branch; 180 tests pass, and a second full run passes as well.
The processor is a FIFO with concurrency 1: `processing` and `attempts + 1` first, image to data URL, `runExtraction`, `applyExtraction` with `todayInOslo(now())`, `findPossibleDuplicate`, then one transaction that deletes lines from an earlier attempt, updates every documented receipt column and inserts the new lines.
Any thrown error sets `failed` with the `ExtractionError` user message or `Ukjent feil under lesing`, logged at `error` with `err`, `receiptId`, `attempts` and `stage`.
`requeueUnfinished` picks up `pending` and `processing` in id order and runs from `buildApp` after migrations; `queueLength` counts the active job; `drain()` resolves when idle and every test uses it instead of timers.
`findPossibleDuplicate` matches on `done`, same date, same total and the same `normalizeText(store_name)`, with two `null` stores equal and the receipt itself excluded.
`normalizeText` matches the section 6 definition and its documented examples.
`GET /api/receipts/:id` returns `ReceiptDetail` with lines joined to products and `imageUrl`; `POST /api/receipts/:id/retry` returns `409` unless `failed`, then `pending` with the error cleared and a `202` summary; both have 401 tests.
Every acceptance bullet has a test, including crash recovery on a temporary database file, sequential processing in id order, line replacement after an interrupted attempt and both duplicate cases.
The T06 F1 deferral is applied: a unique violation inside the upload transaction becomes the same `409`, with a test.
`normalize.ts` arriving one task early is fine; T09 builds on it.
Type-only imports of `better-sqlite3` in `app.ts` and `receiptProcessor.ts` are acceptable; the `SqliteError` check itself lives only in `db/client.ts`, which is what the earlier acceptance line meant.

## Notes for T09

1. Matching needs the saved lines, so the processor changes shape: save the extraction with the status still `processing`, run `matchLines`, append its warnings to `warnings_json`, then set `done` in a last update.
   Set `stage = 'matching'` where `matchLines` starts, not before the save transaction as now.
   A matching failure leaves the receipt `done` with `MATCHING_FAILED`, per the T09 acceptance bullet; only extraction failures end in `failed`.
2. `lineCount` in the retry handler loads every line to count them; when T10's list endpoint needs a count per receipt, use one `count(*)` grouped by `receipt_id` and reuse it here.

## Done

Fast-forward merge now.
