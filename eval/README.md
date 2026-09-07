# Extraction eval harness

Measures extraction quality against real receipts before any prompt, model, provider or
thinking-mode change (ADR-0014).
Never runs from `npm test` or CI, and never runs automatically — it calls the real LLM API and
costs money.

## Running it

```
npm run eval:extraction
```

Builds its LLM client from the same `loadConfig()` the server uses (ADR-0015), so it runs whichever
provider `.env` selects: `LLM_PROVIDER=kimi` (the default) requires a real `MOONSHOT_API_KEY`,
`LLM_PROVIDER=grok` requires a real `XAI_API_KEY`.
The harness measures extraction only and always uses `LLM_PROVIDER`; `LLM_PROVIDER_PROPOSE`
(ADR-0017) has no effect here, though `loadConfig()` still demands both providers' keys when `.env`
names two different ones.
It reads every photo under `eval/receipts/` that has a matching `<photo>.expected.json`, runs the
real extraction on each, prints a table and an aggregate, and writes
`eval/results/<date>-v<promptVersion>-<model>.json` — for Kimi, with a `-thinking` or `-nothinking`
suffix, since `KIMI_THINKING` changes results as much as the model does and the two must not
overwrite each other's file.

A photo with no matching `.expected.json` is skipped, not an error, so a folder half-annotated
with ground truth still runs on the photos that are ready.

## Comparing providers and thinking modes

Price is not a deciding factor here — a long receipt costs a few US cents on any candidate — so the
provider and model are chosen on reading quality alone, by this harness.
The comparison is a small matrix, one `eval:extraction` run per row, each writing its own results
file:

| `LLM_PROVIDER`   | `KIMI_THINKING`                        | Results filename suffix      |
| ---------------- | -------------------------------------- | ---------------------------- |
| `kimi` (default) | `disabled` (default, today's baseline) | `-kimi-k2.6-nothinking.json` |
| `kimi`           | `enabled`                              | `-kimi-k2.6-thinking.json`   |
| `grok`           | — (no thinking mode)                   | `-grok-4.6.json`             |

Every results file also records `provider` and `thinking` (`null` for a provider with no thinking
mode) as fields, not just in the filename, so a row is identifiable even if renamed.
Comparing two rows is a diff of their `aggregate` blocks.

## The expected-JSON shape

`eval/receipts/<photo>.expected.json`, hand-written by looking at the real receipt:

```json
{
  "storeName": "Kiwi",
  "purchasedAt": "2026-09-03",
  "total": 458.9,
  "items": [
    { "text": "TINE LETTMELK 1L", "totalPrice": 100 },
    { "text": "BANAN", "totalPrice": 150 }
  ]
}
```

`storeName` only needs to be a recognisable substring of what gets extracted (`storeMatch` checks
containment, not equality) — the name on the receipt itself, not the full legal entity name.
`total` and every item's `totalPrice` are NOK, not øre, matching the shape `runExtraction` itself
returns.
`items` lists the receipt's purchased items only — no discounts, deposits or other lines — in
whatever order is convenient; matching is by normalized text, not position.

## Bootstrapping ground truth

Typing out a 56-line receipt's ground truth by hand is tedious.
Instead:

```
npm run eval:bootstrap -- eval/receipts/<photo>.jpg
```

Runs one real extraction on that photo and writes `eval/receipts/<photo>.jpg.expected.draft.json`
in the shape above (item lines only).
Open it, correct it against the real receipt — the model will get some texts, prices or the odd
item wrong, that's exactly what the eval is for — and rename it to
`eval/receipts/<photo>.jpg.expected.json` once it's right.

A `.expected.draft.json` file is never treated as ground truth: the main run only looks for the
exact `.expected.json` suffix, so an un-reviewed draft sitting next to a photo is silently
ignored rather than scored as if a human had confirmed it.
Bootstrapping still calls the real LLM API and costs money, the same as `eval:extraction` — it's
the only other code besides `eval/run.ts`'s main run that talks to Kimi or Grok.

## Metrics

Per receipt:

- `dateMatch` — the extracted date equals the expected date exactly.
- `storeMatch` — the normalized expected store name is contained in the normalized extracted one.
- `totalWithin1kr` — the extracted total is within 1 kr of the expected total.
- `itemRecall` — share of expected items found in the extracted lines by normalized text equality
  (any line `kind`, since a model that gets the text and price right but misclassifies the kind
  still found the item).
- `priceAccuracy` — of the items that were found, the share whose extracted total rounds to the
  same øre as expected.
- `lineCountDiff` — extracted line count minus expected item count; positive means the model
  extracted more lines than there are expected items (e.g. it split one item in two, or invented a
  line), negative means it missed some entirely.

Aggregate across the whole eval set: the share of receipts with each boolean metric true, the mean
of `itemRecall` and `priceAccuracy`, and the mean of `|lineCountDiff|`.

## The rule

Any change to the extraction prompt, the default provider or model, the thinking mode or the
extraction output schema ships with an eval run in the same PR, and the aggregate `totalWithin1krRate` and
`meanItemRecall` must not regress against the last committed results file.
Target: at least 90% on both.

Any wrong extraction seen in real use (not just in the eval set) gets added to `eval/receipts/` as
a new case, or to `test/fixtures/llm/` if it's a parsing edge case, before the fix — a bug fixed
without a regression case is a bug that can come back silently.

The prompt version 2 results (T28) are the first committed baseline: prompt version 1 never had
expected JSON for any receipt, so there is nothing earlier to regress against.

## Privacy

`eval/receipts/*.jpg` (and any `.expected.json`/`.expected.draft.json` next to them) are real
household receipt photos and stay out of git entirely (`.gitignore`); the app's own architecture
already treats them as private (`docs/architecture.md` section 5).

A committed results file (`eval/results/*.json`) holds only numbers, booleans and short
identifying strings, keyed by filename — metrics, token counts, duration, the prompt version,
model, provider and thinking mode — never the extracted store name, item texts or amounts as text.
A results file is safe to commit and share as the regression record without it revealing what the
household bought.
