# T33 plan — Kvitteringer: the receipts list shows the date, not only "3 dager siden"

Foreman's task definition, 2026-09-07, on Ruben's request: "på kvitteringsoversikten, legg også til dato, ikke bare '3 dager siden'".
Order: after T30 merges, before T31; it is a twenty-minute task.
Branch `task/T33-receipts-list-date`, pull request per AGENTS.md; docs commit first, then one commit.

## The change

- `src/client/lib/format.ts` gains `formatDateWithRelative(date, today = todayLocalIso())`: the short date the existing `SHORT_DATE_FORMATTER` produces, then ` · `, then `formatRelativeDate` when that is `i dag`, `i går` or `n dager siden`; when the receipt is older than 30 days `formatRelativeDate` already returns the short date, so the result is the short date once, never twice.
  Examples with `today = 2026-09-07`: `2026-09-07` → `7. sep. · i dag`; `2026-09-04` → `4. sep. · 3 dager siden`; `2026-07-01` → `1. jul.`.
- `ReceiptsPage.tsx` `dateLabel` uses it for `purchasedAt` and for the `Lastet opp …` fallback on `createdAt`.
- The receipt detail header and the shopping list history are unchanged.

## Docs commit

- `docs/architecture.md`, section 10, `/receipts` row: "List with store, date as `4. sep. · 3 dager siden`, total, …".
- `docs/tasks.md`, append:

```
## T33 — The receipts list shows the date, not only "3 dager siden"

Goal: a receipt row in the list tells the date at a glance and how long ago that was.

Files: `src/client/lib/format.ts`, `src/client/pages/ReceiptsPage.tsx`, tests.

Acceptance criteria:

- A receipt bought three days ago reads `4. sep. · 3 dager siden` (with today 2026-09-07); one bought today `7. sep. · i dag`; one older than 30 days shows the date once.
- The `Lastet opp` fallback for a receipt without a date uses the same form.
- Screenshot of the list at 360 px under `docs/reviews/screenshots/T33/`.

Tests: `format.test.ts` for the three cases; the `ReceiptsPage` test asserts the new label.
```

## Gate

Pull request, send the number and head SHA; merge after the go-ahead is recorded in `docs/reviews/T33-review.md`.
