# Review: T33 — Kvitteringer

Review of pull request #9, commits `9b99981` (docs) and `0adc76a` (implementation) on `task/T33-receipts-list-date`, 2026-09-07.
Verdict: approved for merge, no required items.

## What was verified

`formatDateWithRelative` returns the short date, a middle dot and the relative form, and the short date alone once `formatRelativeDate` itself falls back to it beyond 30 days, so nothing is shown twice; the three cases from the plan are tested with a fixed `today`.
`dateLabel` uses it for `purchasedAt` and for the `Lastet opp` fallback.
The deviation the PR flags is right and welcome: the fallback used to slice the UTC timestamp, so an upload just after midnight in Oslo read as yesterday; it now goes through `todayInOslo`, which is ADR-0007's rule, with a regression test for the midnight case; this closes the deferral from the T19 review.
The screenshot shows all four cases in one list at 360 px: `7. sep. · i dag`, `4. sep. · 3 dager siden`, `1. juli` and `Lastet opp 7. sep. · i dag`.
Architecture section 10 row and the tasks.md entry follow the plan; the plan file is unchanged.
