# T45 plan — Kvitteringer: a size guard that bounds what it claims to bound

Foreman's task definition, 2026-09-18, from Ruben's issue #15, filed after the T37 real-data check.
Order: after T44 merges. Branch `task/T45-proposal-size-guard`, pull request per AGENTS.md, this plan as the first (docs) commit.

## What is wrong

Both real-data proposals logged:

```
Proposal context exceeded the size guard, narrowed to a 12-week scope and 250 products
originalProducts: 235, narrowedProducts: 235, finalProducts: 235
```

Three counts, all equal: the narrowing changed nothing.
Every purchase in that household already lay inside the 12-week fallback scope and 235 products is under the 250 cap, so both knobs turned without moving anything, and the call went out at the size it would have had with no guard at all.
A household two months old trips it, so the line is on every proposal from now on and says nothing when it appears.
Two failures in one: a guard that does not bound, and a `warn` that does not warn.

## Decisions

1. **The guard is raised to 120,000 characters, provisionally, and the constant carries its own date and reason.** 40,000 was a guess made before anyone had seen a real context. 120,000 is a guess made after, and it is marked in the code as provisional on the measurement this task produces — so the next person finds a number with a reason attached rather than a third guess inheriting the authority of the second.

   What it costs at the ceiling, in section 14's terms: `kimi-k2.6` input is 0.95 USD per million tokens, so a context at the ceiling is roughly 0.3 NOK a tap, about 15 NOK for a weekly tap over a year — the same order as the entire receipt budget in that section, which puts one household year well under 20 NOK. That is the sentence that lets Ruben say "tighter" with something to reason about.

   And the honest part, which the working session was right to put against my first draft: "120,000 characters ≈ 30k tokens" rests on four characters per token, which is an English-prose rule of thumb. This context is JSON whose bulk is `"2026-09-04 x1"` strings, closer to two characters per token, and Norwegian product names subsidise nothing. The real ceiling could be 30k tokens or 55k, and the cost above doubles with it. The recorded evidence cannot settle it: we know the real context was over 40,000 characters and went out at 17–18k prompt tokens, which is consistent with anything from about 2.3 to 4 characters per token, because nobody logged the length — which is the issue's own complaint, one level up.

   This is the foreman's number, not Ruben's; he filed the behaviour, not the constant.
2. **The narrowing narrows until it is under the guard, or it says it failed.** A deterministic ladder, each step measured against `JSON.stringify(...).length` and stopped as soon as the context fits:
   - the 12-week scope,
   - then the 250 products with the most recent purchase,
   - then fewer purchases per product: 6, then 3, then 1,
   - then fewer products: 150, then 75.
   Each step is a rebuild with the same pure `buildProducts`, so the result stays a function of the inputs. If the context is still over the guard after the last step, return it anyway — a proposal that costs more is better than no proposal — and say so in the log.
3. **The log tells the truth about what happened.** One line per call that narrows, at `info` when the ladder succeeded and at `warn` only when it did not, carrying the serialised length before and after, the step that stopped the ladder, and the product counts. A call that fits at full size logs nothing, exactly as today.

## Not in this task

- The prompt, the schema, the model, the thinking mode. The context is built before any of them and none of them change, so no extraction eval (ADR-0016: the proposal prompt is measured by acceptance rate, and this task does not touch it).
- `MAX_PURCHASES_PER_PRODUCT` for the full-size context, `RECENT_SCOPE_DAYS`, or anything about what a proposal contains when it fits. Only the ladder that runs when it does not.
- Anything about the receipts, the products or the list.

## Files

`src/server/domain/proposalContext.ts`, `test/server/proposalContext.test.ts` (or wherever the existing context tests live), `docs/architecture.md` where the guard is described, `docs/adr/0016-llm-shopping-list-proposal.md` if it states the old number, `docs/tasks.md`.

## Acceptance criteria

- A context that fits at full size is returned unchanged and logs nothing.
- A fixture that exceeds the guard purely by product count — many products, few purchases each — comes back under the guard, and the log names the step that got it there.
- A fixture that exceeds the guard with few products and many purchases each comes back under the guard; the purchases-per-product rungs are what does it, which the log shows and the test asserts.
- A fixture that cannot be brought under the guard by any rung is returned anyway, with one `warn` line naming the final length.
- Every successful narrowing logs at `info`, never at `warn`.
- The ladder stops at the first rung that fits: a context that fits after the scope change is not also stripped of purchases.
- The narrowing is pure and deterministic — the same inputs give the same context, with no dependence on iteration order of a `Set` or on the clock beyond `today`.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run format:check` pass; no extraction eval.

## Tests

The four fixtures above, the stop-at-first-rung case, the unchanged-when-it-fits case, and one asserting the logged lengths are the real serialised lengths rather than estimates.
Show at least one failing without the implementation and say which; check any negative assertion the way T42 and T44 were checked.

## What this task is really worth

The ladder is the fix. Once the narrowing actually narrows, the guard's exact value stops deciding anything except when the ladder starts, which is why the constant is not worth more time than the paragraph above gives it.

The measurement is the second half. `runProposal` already records `promptTokens` on every proposal, and this task adds the serialised length to the log; the first real proposal after it ships therefore carries both numbers for the same call, and the characters-per-token ratio for this context follows from dividing one by the other. The constant then changes once, against a measurement, and stops being a guess.

## Afterwards

Close issue #15 with the pull request.
The review records the household's own context length from the demo after the merge, and the ratio derived from that call's `promptTokens` — the question the issue actually asks is whether the household still trips the guard, and no fixture can answer it.
If the ratio says 120,000 characters is far from 30k tokens, the constant moves in a one-line follow-up with the measurement quoted, and the provisional note in the code comes out.
