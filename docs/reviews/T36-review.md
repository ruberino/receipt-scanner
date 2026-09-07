# Review: T36 — Kvitteringer

Review of pull request #11 on `task/T36-weekly-horizon`, head `ae1d389`, 2026-09-07.
Verdict at first pass: one required item (F1), a documentation correction of the foreman's own worked example; the engine change is exactly the plan.
Second pass on `4f0d0c1`: F1 is done; approved, see the go-ahead at the end.

## What was verified

`RECENT_PURCHASE_DAYS` is 1, `HORIZON_DAYS` is 7 with `dueRule = dueIn < 7`, and `formatQuantityText` takes the median of the weekly sums grouped by `isoWeekKey`; nothing else in the engine changed.
ADR-0008 carries a dated amendment naming Ruben's decision and the three changes; section 8 steps 3, 6 and 11 and the worked example are updated.
Tests: the existing example test now expects bananas suggested and eggs skipped, the boundary test is at one day, and three new tests pin the acceptance criteria (weekly product at 2 and 8 days but not 1; biweekly at `dueIn 8` not, at `dueIn 6` yes; same-week purchases summed before the median).
The agent's flag is correct: the milk line the plan added to the worked example ends on 09-03, one day before the example's `today`, so step 3 would skip it; the plan file is corrected in this review's commit.

## Required before merge

- F1. `docs/architecture.md` section 8, worked example, the milk line: replace with "Milk bought 08-17 (2), 08-20 (2), 08-24 (2) and 08-27 (2) → purchase weeks 34 and 35 with weekly sums 4 and 4, `medianGap 7`, `daysSinceLast 8`, `dueIn −1 < 7` → suggested with `quantityText 4 stk`", so every line of the normative example is executable against the same `today`.
  Add that exact dataset to the weekly-sums test with `today = 2026-09-04`, alongside the one already there, so the prose and a passing test say the same thing.

## Go-ahead, 2026-09-07

F1 verified at `4f0d0c1`: the milk line in section 8 is the executable dataset, the matching test runs it against `today = 2026-09-04`, and the plan file carries the same correction.
All five scripts exit 0 in a clean worktree at `4f0d0c1`, 589 tests, Vitest at two workers; CI is green on both jobs.
Approved: re-read this file, commit it on the branch, push, wait for green, merge with `gh pr merge --rebase --delete-branch`, `git pull --ff-only`.
After the merge the foreman updates the demo once its scan queue is empty and checks the live suggestions against the four-Thursday products.
T32 is next, then T34, T37.
