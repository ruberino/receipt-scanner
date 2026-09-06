# Review follow-up: T26 — Kvitteringer

Review of commits `156b693` and `9d75577` (T26) on `task/T26-matching-batches`, 2026-09-06.
Verdict: approved for fast-forward merge, no follow-up items.

## What was verified

All five scripts exit 0 in a clean worktree at `9d75577`, 396 tests, Vitest at two workers.
`matchLines` splits the distinct unmatched texts into batches of at most 20 and makes one call per batch in order; `buildMatchRequest` sets `maxTokens` to 150 per text plus 200, so a full batch gets 3200 and five texts get 950.
A completion with `finishReason: 'length'` is thrown as an `ExtractionError` with `cause { finishReason, batchSize }` before any parsing, and the failure line carries `receiptId`, `stage` and the cause.
Matches from the batches that succeed are applied in the existing transaction; `MATCHING_FAILED` is set when any batch failed and stays mutually exclusive with `UNMATCHED_LINES`, which is the old behaviour extended from one call to any batch.
The two new tests are exactly the acceptance criteria: 45 texts become calls of 20, 20 and 5 with budgets 3200, 3200 and 950; with the second batch truncated, lines 1 to 20 and 41 to 45 are matched by the LLM, line 21 stays unmatched, the warning is `MATCHING_FAILED`, and the error log has the cause.
The ten existing matching tests pass unchanged; no prompt, model or output schema changed, so no eval run was required.
The docs commit put the batching into the numbered matching steps of section 8 instead of a stray bullet, which reads better than the plan's wording.

## After merge

The demo instance is updated to `main`, and receipts 1 and 2 there, both `MATCHING_FAILED` from the truncated single call, get `Prøv matching igjen`; that is the real-data check of this task.
`eval/receipts/2026-09-06-kiwi-56-lines.jpg` stays the long-receipt case for T20.

## Done

Fast-forward merge now and send the hash; T25 is next, then T17 and T18.
