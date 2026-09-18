# Review: T41 — Kvitteringer

Review of pull request #25, commits `7a19103` (docs), `7b6d7b7` (the foreman's environment notes) and `99b7141` (implementation) on `task/T41-duplicate-warning`, 2026-09-18.
Verdict at first pass: approved, no required items; the two parts are where the plan put them, the tests are not vacuous, and the "not in this task" line held.
Reviewed in a separate worktree, per E4 — the working session kept the checkout throughout.

## What was verified

Read-time guard: `withoutDanglingDuplicate` filters the code out of `toReceiptSummary` only when `possibleDuplicateOf` is null, and returns the array untouched otherwise.
Every response shape does go through that one function — `GET /api/receipts` maps it, `buildReceiptDetail` spreads it, `POST /api/receipts/:id/scan` sends it, and `shoppingLists.ts` imports it for a list's linked receipts — so the guard reaches all four, and the tests exercise all four rather than trusting the call graph.
`possibleDuplicateOf` itself is still reported, so the client keeps its link to the other receipt when the pointer is set.
Delete-time cleanup: the referring rows are selected, rewritten and the receipt deleted inside one `app.sqlite.transaction`, and the select runs before the delete — which is the whole point, since `ON DELETE SET NULL` would otherwise have erased the only way to find those rows. `updated_at` moves on the rows that changed and is left alone on the rows that did not, and the test asserts both directions.
`new Date().toISOString()` inline is the convention in `routes/`; `nowIso` is local to the processor, so this is consistent, not a slip.
Tests: 8 new, 822 in total. The working session's claim that five of them fail without the fix is correct and I reproduced it — reverting only `src/server/routes/receipts.ts` to `main` in my worktree leaves `5 failed | 24 passed` in that file, and the five are exactly the four response shapes and the delete-time cleanup. The other three pass either way by design: they guard against the filter over-reaching, which is what they are for.
Docs: the read-time rule is in the `warnings_json` paragraph of section 6 and the cleanup in the `DELETE` row of section 9, both worded as behaviour rather than as implementation.
Scope: `git diff --stat` against `main` touches `src/server/routes/receipts.ts` and `test/server/receipts.test.ts` and nothing else under `src/`; the label wording, the blush block, `findPossibleDuplicate` and any migration are untouched, as the plan required.
All five scripts exit 0 in a clean worktree at `99b7141` (Node 24.21.0, 822 tests in 54 files); CI is green on both jobs.

## Noted, no action

- For a row stored before this task, the served warnings and `warnings_json` disagree until the receipt is deleted or patched. That is the design — part 1 is what makes the old rows right without a migration — and it is written into section 6 so the next reader is not surprised.
- A `PATCH` that touches store, date or total already recomputes `POSSIBLE_DUPLICATE` from scratch and writes the result back, so it quietly cleans a stale code out of storage too. One more path that heals an old row; nothing to do about it.
- The stale code still sits in the demo and household databases until one of those two paths runs. Nothing on screen shows it any more, which was the task.

## Go-ahead, 2026-09-18

Approved at `99b7141`, no second pass needed: merge with `gh pr merge --rebase --delete-branch`, then `git pull --ff-only`.
`7b6d7b7` (E3 and E4 in `docs/reviews/environment.md`) is foreman content riding on this branch and merges with it, as the pull request says.
The `#null` follow-up from the design review is closed by this task.
