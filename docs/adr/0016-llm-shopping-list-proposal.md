# ADR-0016: An LLM proposal beside the rule engine, user-triggered and reviewed

- Status: Accepted
- Superseded in part by ADR-0017 (the proposal need not use "the same provider as extraction and matching" any more)
- Date: 2026-09-07

## Context

The rule engine (ADR-0008) only knows repetition: due dates and frequency from purchase history.
It cannot know that Halloween is coming, that a school holiday changes what the household needs, that lutefisk season has started, or that the household bought nappies every week two years ago and has not needed them since.
Ruben asked for an AI-recommended weekly list that is aware of the season and the calendar, scoped to recent purchases, and that varies dinner items so the household does not eat the same thing every week.
Ruben's decisions, asked and answered the same day: variation in dinner items but no named weekly menu; a separate `Foreslå med AI` button whose proposal the user reviews item by item, with the rule engine staying as the baseline; no household notes field; public holidays, Oslo school holidays, Halloween, advent and fellesferie, and date-based seasonal goods all count; Ruben has decided the app may pay a few øre for this per tap.

## Decision

- The rule engine stays the baseline: every new list is still filled by `computeSuggestions`, unchanged.
  The AI proposal is an explicit, paid, user-triggered addition on top of it, never a replacement and never automatic.
- A third `LlmPurpose`, `propose`, alongside `extract` and `match`; the same `LlmClient` interface and the same active provider (ADR-0003, ADR-0015) — no new provider wiring.
- `POST /api/shopping-lists/:id/proposals` builds a context from the household's purchase history (last 26 weeks), today's date, the calendar events of the next three weeks (`src/shared/calendar.ts`), what is already on the list, and what has been dismissed from it or rejected from an earlier proposal on it; one text-only call returns 5 to 15 additions, each with a Norwegian reason and a kind (`sesong`, `merkedag`, `variasjon`, `vane`).
- The model's answer is a proposal, never applied blindly: the user sees every item pre-checked, unchecks what they do not want, and `POST .../accept` inserts only the chosen subset, `source = 'ai'`.
- Every proposal and its accepted subset are stored (`shopping_list_proposals`), so the acceptance rate (`accepted items / proposed items`) is the ongoing quality metric for the prompt, in production, from real use.

## Consequences

- One call of roughly 6,000–10,000 prompt tokens per tap, a few US cents on any provider (ADR-0015's price-is-not-a-factor stance); cost is bounded because the call is explicit and user-triggered, not automatic per list.
- The output is non-deterministic, so tests inject `FakeLlmClient`, same as extraction and matching; there is no ground-truth eval set for this prompt, because there is no single correct weekly list to compare against.
  Acceptance rate over `shopping_list_proposals` replaces the eval-harness rule for this one prompt; `AGENTS.md`'s eval bullet gains a sentence saying so.
- Purchase history goes to the provider as text; the receipts already send the household's purchases as images for extraction, and section 11's privacy note is updated to cover this second data flow to the same provider.
- A new `source = 'ai'` value on `shopping_list_items` is a table recreate in SQLite (the `CHECK` constraint changes); the migration test must show existing lists, items and dismissals survive it with their ids, the same discipline as every earlier recreate (T24).
- The calendar module is pure and has no I/O, so its dates are covered by ordinary unit tests, independent of the LLM.

## Alternatives considered

- The AI replacing the rule engine: no deterministic baseline left, every list would cost a call, and there would be nothing to compare a bad proposal against.
- A named weekly menu (e.g. "Taco Friday"): rejected — Ruben wants variation in what is bought, not a meal-planning feature with named dinners.
- Applying the model's proposal directly to the list without review: rejected — the whole point of keeping the rule engine as the trusted baseline is that the AI's judgement is optional and inspectable, one item at a time, same spirit as matching's alias upsert only happening after the LLM's own answer is parsed and validated.
