# Review follow-up: T25 — Kvitteringer

Review of commit `4bd4a15` (T25) on `task/T25-unmatched-recompute`, 2026-09-06.
Verdict: approved for fast-forward merge, no follow-up items.

## What was verified

All five scripts exit 0 in a clean worktree at `4bd4a15`, 400 tests, Vitest at two workers.
`PATCH /api/receipt-lines/:id` checks inside its existing transaction whether any item line on the same receipt still has `product_id IS NULL`; when none does, `UNMATCHED_LINES` is filtered out of the receipt's warnings, `updated_at` is bumped and `MATCHING_FAILED` is left alone.
Discount, deposit and other lines never have a product and are excluded by the `kind = 'item'` filter, and one of the four tests proves it.
The four tests go through the real endpoints, `PATCH` then `GET`: last unmatched line removes the warning, one of two leaves it, `MATCHING_FAILED` stays, a discount line does not block the recompute.
The docs row for `PATCH /api/receipt-lines/:id` in section 9 carries the new sentence.

## Process note

The agent stayed on `main` after the T26 merge and began this work there, noticed before committing, moved the work to a branch and fast-forwarded only the foreman's T26 note as its own commit (`9d3be3f`).
Nothing landed on `main` without a branch.
Correction, 2026-09-07: this repository already has the pre-commit hook that refuses commits on `main` (`c422246`, `5fd4651`) with `core.hooksPath` set, so a commit on `main` could not have happened; the earlier sentence here saying the hook would come with T22 was wrong.

## Done

Fast-forward merge now and send the hash; T17 is next, then T18.
