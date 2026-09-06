# Review follow-up: T07 — Kvitteringer

Review of commit `c1f61f5` (T07) on `task/T07-extraction-schema`, 2026-09-06.
Verdict: approved for fast-forward merge after F1; F2 is a small alignment to do in the same commit.

## What was verified

All five scripts exit 0 on the branch; 157 tests pass.
The system prompt covers every section 7.3 requirement: the Norwegian conventions, exactly one JSON object with arrays only under `lines`, `text` as printed, the excluded line types, a field-by-field description and one complete example; `EXTRACT_PROMPT_VERSION` is 1.
Amounts go through `parseDecimal` rather than `parseNok`, which is right: `applyExtraction` converts to øre afterwards, so `parseNok` would have converted twice; the architecture wording was inconsistent on that point and the code follows the downstream step.
The lenient preprocess handles unknown `kind`, bad `quantity`, `g`/`hg`/`ml`/`cl`/`dl` conversions and unknown units; only an empty `text`, an unparsable `totalPrice` or a non-array `lines` fail, and a test proves exactly that.
`parseExtraction` and `runExtraction` throw the documented messages, and the envelope carries `raw`, `model`, `promptVersion` and `usage`.
`applyExtraction` produces the four warnings, excludes `other` lines from the sum, throws `Fant ingen varelinjer` without item lines and numbers lines from 1.
The six fixtures are realistic and the REMA fixture sums exactly to its total, so the no-warning case is genuine.
The commit body says why `npm run eval:extraction` could not run.

## F1 — Required before merge: a `null` or missing `unit` must keep the quantity

Reproduced on the branch: a line `{ text: 'TINE LETTMELK 1L', kind: 'item', quantity: 2, unit: null, totalPrice: 43.8 }` comes out with `quantity 1`, and a line without a `unit` key likewise.
`null` is a valid unit in section 7.3 ("`stk`, `kg`, `l` or null"); only a value outside that set is meant to reset the quantity.
Multi-quantity lines without a printed unit are common on Norwegian receipts, so this loses real data.

Steps: in the `lineSchema` preprocess, treat a missing or `null` `unit` as `unit: null` with the parsed quantity kept; keep the reset to 1 for unknown strings only.

Tests to add to `test/server/llm/extractReceipt.test.ts`: `unit: null` with `quantity: 2` keeps 2; a line without `unit` with `quantity: 3` keeps 3; `unit: 'pk'` still resets to 1.

Acceptance: the three tests pass and the odd-units test stays green.

## F2 — Required in the same commit: more than 200 lines truncates instead of failing

Section 7.3 says only three conditions fail validation; `z.array(lineSchema).max(200)` adds a fourth.
Preprocess `lines` to its first 200 entries and drop the `.max(200)`.

Acceptance: a fixture-free test with 201 minimal lines parses to 200.

## Done

F1 and F2 as one `fix:` commit on the T07 branch, then fast-forward merge and send the hash.
