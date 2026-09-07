# ADR-0008: Rule-based deterministic suggestion engine, no LLM

- Status: Accepted
- Date: 2026-09-05

## Context

The shopping list suggestion must answer "what will we probably need this week?" from purchase history.
The household shops about once a week, so intervals cluster around multiples of seven days.
Explainability matters: a suggestion should say why it is there, and a user should be able to predict what removing or suppressing a product does.
An LLM could produce plausible lists but not stable, testable, explainable ones.

## Decision

- `computeSuggestions(histories, today)` in `src/server/domain/suggestions.ts` is a pure function with no I/O.
- Per product: require purchases in at least two distinct ISO weeks; skip if bought within the last three days; compute the median gap between purchase weeks, in days, so it is never below 7; skip stale products (`daysSinceLast > max(60, 3 × medianGap)`).
- Suggest when the product is due (`medianGap − daysSinceLast <= 3`) or frequent (bought in at least 6 of the last 12 ISO weeks).
- Rank by `daysSinceLast / medianGap` descending, then by name.
- Each suggestion carries a Norwegian reason string and a quantity hint from the median quantity.
- Products with `suppressed = 1` are never suggested; user corrections and merges change history and therefore suggestions automatically.
- Thresholds (3 days, 60 days, factor 3, 6 of 12 weeks) are constants at the top of the module and are covered by tests; changing them is a code change with a test update, not a config flag.
- The exact algorithm and a worked example are in `architecture.md` section 8; that section is normative.

## Consequences

- Suggestions are reproducible and unit tested against fixtures.
- Every suggestion is explainable in one line, which makes the list trustworthy.
- New products need purchases in two different weeks before they are suggested; the user adds them manually until then.
- Seasonal or event-driven purchases are not modelled; the user edits the list.
- No LLM cost or latency when opening the shopping list.

## Alternatives considered

- Asking the LLM for a list from the purchase history: not deterministic, hard to test, unexplained changes week to week.
- Simple "everything bought last week": misses biweekly and monthly items and repeats one-off purchases.
- Statistical models (Poisson or survival analysis): more accurate in theory, but the data is tens of purchases per product and the gain is not worth the opacity.

## Amendment, 2026-09-07 (T36): the list is a week's shopping

Ruben's decision: the shopping list should suggest food for at least the coming seven days, not just what is needed right this moment.
Three constants and one formula change; the engine stays pure and deterministic.

- "Bought this trip" shrinks from three days to one (`RECENT_PURCHASE_DAYS = 1`): a product bought yesterday is still excluded, but one bought two days ago is now a candidate.
- The due rule becomes a seven-day horizon (`HORIZON_DAYS = 7`, replacing `DUE_SOON_DAYS = 3`): a product is due when it will run out strictly before a trip seven days out (`medianGap − daysSinceLast < 7`), not only within three days of running out.
- The quantity hint is the median of each purchase week's total, not of individual purchases: two purchases in the same week (buying milk twice on a big shopping week) count as one week's worth, so the list sizes for a week, not a single trip.

Architecture.md section 8 and its worked example are updated accordingly and stay normative.
