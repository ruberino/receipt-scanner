# Review follow-up: T12 — Kvitteringer

Review of commit `04fd471` (T12) on `task/T12-suggestions`, 2026-09-06.
Verdict: approved for fast-forward merge, no follow-up items.

## What was verified

All five scripts exit 0 on the branch; 274 tests pass.
`computeSuggestions` is pure and follows section 8 step by step: suppressed products skipped; purchase weeks counted as distinct `isoWeekKey` values with fewer than two skipped; `daysSinceLast <= 3` skipped; the median gap measured between the Mondays of consecutive purchase weeks so it is always a whole number of weeks, times 7; the stale rule `max(60, 3 × medianGap)`; the due rule `dueIn <= 3`; the frequency rule on distinct weeks within 84 days over 12; score `daysSinceLast / medianGap`; the two Norwegian reason texts with the due text taking precedence; `quantityText` from the median quantity with one decimal and a comma for `kg`, otherwise `max(1, round)` and `stk`; sorted by score then Norwegian name order.
The thresholds are named constants at the top of the module, as ADR-0008 requires.
The worked example is a fixture and the test reproduces it exactly: milk with score 1.0 and the weekly reason, coffee suggested with `medianGap 21`, flour stale, bananas bought this trip, chips with one purchase week.
One test per rule covers the single purchase, two purchases in one ISO week, the three-day boundary on both sides, stale, due alone, frequency alone and suppressed; `2 stk` and `1,1 kg` are tested; the sort is tested for stability; a half-week median gap gets the Norwegian comma.
`GET /api/suggestions` reads `loadProductHistories` with `todayInOslo(now())` on the injected clock and has its 401 test plus an end-to-end case.
Using the most recent purchase's unit for `quantityText` is a sound call; units do not change for one product in practice.
Verifying the fixtures numerically with a scratch script before writing the expectations is the right way to build tests of an algorithm.

## Done

Fast-forward merge now.
