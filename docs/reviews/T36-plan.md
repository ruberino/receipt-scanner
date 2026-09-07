# T36 plan — Kvitteringer: the list is the week's shopping

Foreman's task definition, 2026-09-07, on Ruben's decision: "handlelisten skal lage et forslag for en ukeshandel, dvs mat for minst 7 dager".
Today the engine suggests a product only when it is due within 3 days and sizes it by the median single purchase, which is a "what do I need right now" list, not a week's shopping.
Order: after T31 merges, before T32; the engine is pure code, so this is a small task with a large effect.
Branch `task/T36-weekly-horizon`, pull request per AGENTS.md, docs commit first.

## The change in one paragraph

A product goes on the list when the household will run out of it before the next weekly trip, and its quantity is what the household uses in a week.
Three rules in `computeSuggestions` change; nothing else does.

## Rules (architecture section 8, normative; update the text and the worked example)

- Step 3: skip if `daysSinceLast <= 1` (bought today or yesterday) instead of `<= 3`.
  `RECENT_PURCHASE_DAYS = 1`.
- Step 6: `dueRule = dueIn < 7`, that is, the product runs out strictly before a trip seven days from today.
  `HORIZON_DAYS = 7`; the constant replaces `DUE_SOON_DAYS`.
  Since `medianGap` is a whole number of weeks and therefore at least 7, a product bought today is never due by this rule, and one bought two days ago with a weekly cadence is (`dueIn 5`).
- Step 11: `quantityText` is the median of the weekly sums, not of the single purchases: group the purchases by `isoWeekKey(date)`, sum the quantities within each purchase week, take the median over those weeks; `kg` keeps one decimal, everything else rounds to a whole count, at least 1, as today.
  Milk bought on Monday (2) and Thursday (2) of the same week counts as 4 for that week.
- Steps 1, 2, 4, 5, 7, 8, 9 and 10 are unchanged; the `reason` wording is unchanged.

Worked example, `today = 2026-09-04`, replace the bananas line and add two:

- Bananas bought 08-26 and 09-02 → `medianGap 7`, `daysSinceLast 2`, `dueIn 5 < 7` → suggested (before this task it was skipped as bought this trip).
- Eggs bought 08-27 and 09-03 → `daysSinceLast 1` → skipped, bought yesterday.
- Milk bought 08-17 (2), 08-20 (2), 08-24 (2) and 08-27 (2) → purchase weeks 34 and 35 with weekly sums 4 and 4, `medianGap 7`, `daysSinceLast 8`, `dueIn −1 < 7` → suggested with `quantityText 4 stk`.
  (Corrected during review: the first version of this line ended on 09-03, one day before `today`, which step 3 skips.)

## Docs commit

- `docs/adr/0008-rule-based-suggestion-engine.md`: an amendment dated 2026-09-07: the list is the week's shopping (Ruben's decision), so the horizon is seven days and quantities are weekly sums; the engine stays pure and deterministic.
- `docs/architecture.md` section 8 as above; section 2 scenario 3 unchanged.
- `docs/tasks.md`, append:

```
## T36 — The list is the week's shopping

Goal: everything the household will run out of within the coming week is on the list, in the week's quantity.

Files: `src/server/domain/suggestions.ts`, `docs/adr/0008-*.md`, tests.

Steps: see `docs/reviews/T36-plan.md`.

Acceptance criteria:

- A product with a weekly cadence bought two days ago is suggested; bought yesterday it is not; bought eight days ago it is, with the same reason text as before.
- A product bought every two weeks and last bought six days ago is not suggested (`dueIn 8`); last bought eight days ago it is (`dueIn 6`).
- A product bought twice in one week is suggested with the sum of that week's quantities.
- `npm test` is the only verification; no LLM call is involved.
```

## After merge

The foreman checks the demo's live suggestions (`GET /api/suggestions`) against the products bought four Thursdays in a row; they must appear with weekly quantities.
T37's prompt follows the same frame: the plan there gains "for the coming seven days".

## Gate

Pull request, send the number and head SHA; merge after the go-ahead is recorded in `docs/reviews/T36-review.md`.
