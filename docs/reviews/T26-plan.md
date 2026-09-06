# T26 plan — Kvitteringer: product matching in batches, with a token budget that fits

Foreman's task definition from a real-world failure in Ruben's demo, 2026-09-06.
Order of work: T24, then T26, then T25, then T17.
Branch `task/T26-matching-batches`.

## What happened

Receipt 2 in the demo is a Kiwi receipt with 56 lines.
Extraction succeeded: 2363 completion tokens, `finish_reason: stop`, budget 6000.
Matching sent every unmatched text in one call with `MAX_TOKENS = 2000`; the answer stopped at 2000 tokens with `finish_reason: length`, the truncated JSON failed in `parseJsonObject`, and the receipt ended `done` with `MATCHING_FAILED` and no product on any line.
The log line said only `Kunne ikke tolke svaret fra lesingen`, which is what a malformed answer would say too; the cause was visible only because the preceding `LLM call completed` line carried `finishReason: "length"`.

## Change

1. `matchLines` splits the distinct unmatched texts into batches of at most 20 and makes one LLM call per batch, in order.
2. `buildMatchRequest` computes `maxTokens` from the batch: 150 per text plus 200, so a full batch gets 3200.
3. A batch whose completion has `finishReason === 'length'` is a failed batch before parsing; throw `ExtractionError('Kunne ikke tolke svaret fra lesingen', 'matching')` with `cause` `{ finishReason, batchSize }` so the failure line is triage-ready.
4. Matches from successful batches are saved as today; `MATCHING_FAILED` is added when any batch failed, and the lines of a failed batch stay unmatched so `Prøv matching igjen` covers them.
5. No prompt, model or output-schema change, so no eval run is required by AGENTS.md; if you find you need one, stop and ask.

## Docs commit first

`docs/architecture.md`, matching section: "Unmatched texts are matched in batches of at most 20 per call with a token budget of 150 per text plus 200; an answer cut off at the budget counts as a failed batch, the other batches' matches are kept, and `MATCHING_FAILED` is set when any batch failed."

`docs/tasks.md`, append:

```
## T26 — Product matching in batches

Goal: a long receipt never loses all its matches to one truncated answer.

Files: `src/server/domain/matching.ts`, `src/server/llm/matchProducts.ts`, `src/server/llm/KimiClient.ts` if the finish reason is not yet surfaced to callers, tests.

Steps: see `docs/reviews/T26-plan.md`.

Acceptance criteria:

- 45 distinct unmatched texts produce three LLM calls of 20, 20 and 5 texts with `maxTokens` 3200, 3200 and 950.
- When the second batch answers with `finishReason: 'length'`, the matches from batches one and three are saved, the receipt gets `MATCHING_FAILED`, and the error log carries `finishReason` and `batchSize`.
- A receipt with 5 unmatched texts behaves exactly as before.
```

## Tests

`FakeLlmClient` scripted per call: batch sizes and `maxTokens` asserted on the requests; one truncated answer with `finishReason: 'length'`; the existing matching tests unchanged.

## Regression case for T20

The receipt image is saved locally as `eval/receipts/2026-09-06-kiwi-56-lines.jpg` (gitignored, real data, stays on this machine).
When the eval harness lands, it is the long-receipt case: extraction finishes with `stop`, matching produces no `MATCHING_FAILED`.

## Gate

Send the hashes before merging, as always.
