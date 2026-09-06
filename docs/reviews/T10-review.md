# Review follow-up: T10 — Kvitteringer

Review of commit `047c3f5` (T10) on `task/T10-receipts-api`, 2026-09-06.
Verdict: approved for fast-forward merge after F1.

## What was verified

All five scripts exit 0 on the branch; 214 tests pass; `openai` is imported only by `KimiClient.ts`.
`GET /api/receipts` pages newest first on an id cursor with `limit` 1–100 (default 50), and `lineCount` comes from one `count(*) … group by receipt_id`, which the retry handler now reuses.
`PATCH /api/receipts/:id` answers `409` unless `done`, validates with a strict partial schema, recomputes `TOTAL_MISMATCH` against the line sum and re-runs `findPossibleDuplicate` from scratch whenever store, date or total is patched, sets `reviewedAt` on `reviewed: true` and returns `ReceiptDetail`; both warnings are tested in both directions.
`DELETE /api/receipts/:id` relies on the documented cascades, with a test that the image and lines go with it.
`PATCH /api/receipt-lines/:id` takes exactly one of `{ productId }` or `{ newProductName, category? }`, links or creates the product, upserts the `user` alias replacing an `llm` one, sets `match_source = 'user'` and returns the line with its product; eight tests, including a later receipt mapping by the new alias.
Every endpoint has its 401 test.
Disallowing `null` for `purchasedAt` and `totalOre` in the patch is the right call: `applyExtraction` guarantees both on a `done` receipt, and a review screen has no reason to clear them.

## F1 — Required before merge: a correction clears the warning it fixes

After `PATCH` sets a real store name, `MISSING_STORE` stays; after it sets the real date, `MISSING_DATE` stays and `FUTURE_DATE` is never recomputed.
The user has fixed exactly what the warning complained about, so the warning must follow the data.

Architect clarification for `docs/architecture.md` section 9, the `PATCH /api/receipts/:id` row; replace "Recomputes `TOTAL_MISMATCH` and `POSSIBLE_DUPLICATE`." with, verbatim:

```md
Recomputes `TOTAL_MISMATCH` and `POSSIBLE_DUPLICATE`; when `storeName` is patched, `MISSING_STORE` is set only if it is null; when `purchasedAt` is patched, `MISSING_DATE` is removed and `FUTURE_DATE` is set only if the date is after `todayInOslo()`.
```

Steps:

1. Apply the docs line as its own `docs:` commit on the branch.
2. In the patch handler, when `storeName` is in the body: drop `MISSING_STORE`, add it back if the new value is `null`.
   When `purchasedAt` is in the body: drop `MISSING_DATE` and `FUTURE_DATE`, add `FUTURE_DATE` if the new date is after `todayInOslo(now())`, using the same `now` the processor gets so tests can pin it.
3. Tests: a receipt with `MISSING_STORE` patched to a store name loses the warning; patched to `null` keeps it; a receipt with `MISSING_DATE` patched to a past date loses it; patched to a future date gets `FUTURE_DATE`; patched back to today loses `FUTURE_DATE`.

Acceptance: the five tests pass and the docs commit touches only `docs/architecture.md`.

## Recommendation, no action now

`matching.ts` creates products from LLM names without a length cap, while the API caps `newProductName` at 120; cap the LLM name the same way when the file is next touched.

## Done

Docs commit, then the fix commit with the tests, then fast-forward merge and send the hashes.
