# T28 plan — Kvitteringer: keep long receipt images legible

Foreman's task definition, 2026-09-07, from a real-world failure Ruben saw in the demo: "Kimi bommer katastrofalt på pris".
Order: after T27 merges, before anything else.
Branch `task/T28-legible-long-receipts`, pull request per AGENTS.md, docs commit first.

## What happened

Receipts 5, 6 and 7 in the demo are Kiwi receipts with 48 to 56 lines.
Their stored images are 149×2000, 149×2000 and 142×2000 pixels, 45 to 48 kB each.
Both `downscaleImage` on the phone and `normaliseImage` on the server cap the long edge at 2000 px, so a tall receipt strip is shrunk until its text is a few pixels high.
The model then invents: every line has quantity 1, `unitPrice` is missing on two of the three, the texts read like tidy product names rather than printed text, and the line sums are 1832 kr against a printed total of 1002 kr, 2142 against 2309, and 1109 against 1441.
The prompt is not the problem; the model never saw the digits.
All four Kiwi images are saved under `eval/receipts/` (gitignored) as the regression cases for this task.

## Change

1. Resize by the short edge, never the long one: `normaliseImage` scales so the short edge is at most 1600 px, never enlarges, keeps JPEG quality 85, and no longer caps the long edge; `downscaleImage` on the client applies the same rule so the phone does not destroy the image first.
   The 10 MB upload limit stays.
2. Tile at extraction time: `extractReceipt.ts` cuts the stored image into vertical segments of at most 2000 px height with 120 px overlap when the image is taller than 2000 px, and sends them as consecutive `image_url` parts in one request, top to bottom.
   A single image stays one part; the stored image is never modified.
3. Prompt, `EXTRACT_PROMPT_VERSION` 2, three additions:
   - "The receipt may arrive as several images that are consecutive segments of one receipt from top to bottom, with a small overlap; read them as one receipt and do not repeat a line that appears in the overlap."
   - Digital receipts from Trumf, Meny and Kiwi: the total is labelled "Kjøpesum" or "Å betale"; a sub-line such as "Tilbud (-10,00 kr)" or "Rabatt (-x kr)" printed under an item whose amount is already reduced is informational, not a discount, and must not become a line; "Totale besparelser", "Trumf-Bonus", "Grunnbonus" and "Bonusgrunnlag" lines are never lines either.
     Seen on receipt 8 (MENY Lambertseter, 2026-09-04): the model emitted "Tilbud (-10,00 kr)" as a discount of −10 kr under "Lunsjkake varm pr stk 20,00", so the lines summed to 39,90 against a printed total of 49,90 and the receipt got a false `TOTAL_MISMATCH`.
   - Reconciliation: "Before answering, add up totalPrice over all lines; it must equal total. If it does not, re-check whether a discount is already reflected in the item amount above it, or whether a line was missed, and correct the lines; only keep a difference when the receipt itself is inconsistent."
   `eval/receipts/2026-09-07-receipt-8.jpg` with its `.expected.json` (written by the foreman from the image) is the regression case for this.
   Kimi's vision guide says images should be no larger than 4K resolution, and xAI caps an image at 20 MiB; a 1600×2000 segment is well inside both, and the segment height stays configurable in one constant.
4. Token budget: extraction `MAX_TOKENS` stays 6000; check the observed completion tokens on the four Kiwi receipts after the change and raise it if any run ends with `finishReason: 'length'`.
5. The eval harness needs no change; its `extractPhoto` goes through the same `normaliseImage` and `runExtraction`.

## Docs commit

- `docs/architecture.md` section 7.1: the resize rule (short edge at most 1600 px, no long-edge cap, no enlargement, JPEG 85) and the tiling rule (segments of at most 2000 px, 120 px overlap, consecutive image parts).
- ADR-0005 amendment paragraph dated 2026-09-07 with the 149×2000 finding as the reason.
- `docs/tasks.md`, append:

```
## T28 — Keep long receipt images legible

Goal: a 56-line receipt is read from an image where the digits are legible, not from a 149 px wide strip.

Files: `src/server/lib/images.ts`, `src/client/lib/downscaleImage.ts`, `src/server/llm/extractReceipt.ts`, `src/server/llm/prompts/extractReceipt.prompt.ts`, tests.

Steps: see `docs/reviews/T28-plan.md`.

Acceptance criteria:

- A 600×8000 image is stored as 600×8000; a 3000×20000 image is stored as 1600×10667; neither is enlarged.
- A stored 1600×10667 image is sent as six consecutive segments with 120 px overlap; a 1200×1600 image is sent as one.
- The four Kiwi receipts in `eval/receipts/` are re-run through the eval once their expected JSON exists, and `totalWithin1krRate` and `meanItemRecall` are recorded in the results file committed with the PR.
```

## Eval

This is a prompt and pipeline change, so AGENTS.md requires an eval run with non-regressed aggregates before merge.
Ruben produces the expected JSON for the four Kiwi receipts and the two Meny receipts with `npm run eval:bootstrap` and corrects the drafts by hand; the bootstrap drafts for the long Kiwi receipts must be made after step 1 and 2 are in place, or they will be as wrong as today.
Run the eval on the branch, commit the results file as the baseline for prompt version 2, and paste the aggregate in the PR description.

## Gate

Pull request, send the number; merge after the go-ahead is recorded here.
