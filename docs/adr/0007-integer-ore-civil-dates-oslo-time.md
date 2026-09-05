# ADR-0007: Money as integer øre, civil dates, Europe/Oslo as the household time zone

- Status: Accepted
- Date: 2026-09-05

## Context

Receipts carry amounts with two decimals and a decimal comma.
Floating point sums of prices produce values like 43.800000000000004 and break total checks.
Purchase dates are printed as civil dates; the exact time is irrelevant.
Week grouping for the suggestion engine must be stable regardless of where the server runs.

## Decision

- All amounts are stored and transported as integer øre (`total_ore`, `unit_price_ore`, `total_ore` on lines).
  The LLM returns NOK decimals; `applyExtraction` converts with `Math.round(x * 100)`.
  The client formats with `formatOre`, for example `43,80 kr`.
- Dates are civil dates as `YYYY-MM-DD` strings in the database, the API and the domain code; `Date` objects are used only inside helper functions.
- The household time zone is `Europe/Oslo`.
  `todayInOslo()` computes the civil date with `Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' })`, and the Docker image sets `TZ=Europe/Oslo` for consistency in logs.
- Weeks are ISO weeks starting on Monday; `mondayOf(date)` and `isoWeekKey(date)` are the only week functions and are unit tested around year boundaries.
- Timestamps such as `created_at` are ISO 8601 UTC strings.

## Consequences

- Sums are exact and total checks are reliable.
- No time zone bugs between phone and server for purchase dates.
- Formatting is a client concern; the API never sends formatted strings for amounts.
- Any date arithmetic must go through the shared helpers, which is easy to enforce in review.

## Alternatives considered

- `REAL` in NOK: floating point errors in sums.
- Storing datetimes for purchases: false precision; receipts are day-level events.
- Server local time without a fixed zone: week boundaries would shift if the hosting region changed.
