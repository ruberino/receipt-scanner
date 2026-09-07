# Review: T28 — Kvitteringer

Review of pull request #3, commits `167cede` and `19a6b5e` (T28) on `task/T28-legible-long-receipts`, 2026-09-07.
Verdict: not yet approved; four required items (F1–F4) below, all small.
The image pipeline, the segmenting and prompt version 2 are right; what is missing is one test the PR claims to cover, one phone-side guard, one correction to the eval wording and the results files.

## What was verified

All five scripts exit 0 in a clean worktree at `19a6b5e`, 506 tests, Vitest at two workers; CI run 34112156521 is green on both jobs.
`normaliseImage` caps the short edge at 1600 px, never the long edge, never enlarges, and reads the visual short edge through the EXIF orientation: I probed a 20000×3000 JPEG tagged orientation 6 and 8 and a 3000×20000 tagged 6, and got 1600×10667, 1600×10667 and 10667×1600, which is exactly right.
`segmentImage` produces six segments of 2000, 2000, 2000, 2000, 2000 and 1267 px for 1600×10667, one segment for anything at most 2000 px tall, and never touches the stored bytes.
`extractReceipt.ts` sends one `image_url` part per segment before the text part; `OpenAiCompatibleClient` keeps the order; `receiptProcessor.ts` and `eval/run.ts` pass the stored bytes instead of a pre-built data URL.
Prompt version 2 carries the three additions from the plan word for word in meaning.
The ESLint restructure is correct: three non-overlapping blocks, and the openai-SDK confinement is enforced again; this was a real latent bug and the fix belongs in this PR because the task added the `segmentImage` import path.
ADR-0005 amendment, architecture 7.1 and 7.3, tasks.md and the client mirror follow the plan; the plan file is unchanged.

### Eval, prompt version 2, run by the foreman with the demo keys

Three receipts with hand-written ground truth (`receipt-8`, `receipt-11`, `receipt-12`, all MENY digital receipts with the informational `Tilbud` sub-lines that produced the false `TOTAL_MISMATCH` warnings).

| Row                        | totalWithin1krRate | meanItemRecall | meanPriceAccuracy | meanAbsLineCountDiff | Duration per receipt |
| -------------------------- | ------------------ | -------------- | ----------------- | -------------------- | -------------------- |
| kimi-k2.6, thinking off    | 100%               | 100%           | 100%              | 0.00                 | 5.6–10.1 s           |
| kimi-k2.6, thinking on     | (pending)          |                |                   |                      |                      |
| grok-4.6                   | (pending)          |                |                   |                      |                      |

On prompt version 1 the same three receipts each got a bogus discount line and a wrong line sum; version 2 removes every one of them.
This set cannot yet say anything about long receipts: the four Kiwi files in `eval/receipts/` are 149×2000 px copies of what the database stored, so no resize rule can recover them (see F3).

## Required before merge

- F1. `test/server/images.test.ts`: add the EXIF case the PR description claims, a synthetic JPEG written with `.withMetadata({ orientation: 6 })` whose raw size is 20000×3000 and whose stored result must be 1600×10667, plus the mirror with orientation 8.
  A phone stores most portrait photos exactly this way, so this branch is the common path, and today nothing fails if `ROTATED_ORIENTATIONS` is deleted.
- F2. `src/client/lib/downscaleImage.ts`: guard the canvas.
  WebKit on iOS refuses a canvas whose area exceeds 16 777 216 px ("Canvas area exceeds the maximum limit"), and the plan's own target of 1600×10667 is 17.07 M px, so on an iPhone the very receipts this task is for would fail in `drawImage`/`toBlob` whenever the client has to redraw (a PNG, a JPEG over 500 KB, or any resize).
  Rule: when `target.width * target.height > 16_777_216`, return the file unchanged and let `normaliseImage` do the work; `MAX_UPLOAD_BYTES` (10 MB) stays the ceiling.
  Test: a 3000×20000 JPEG source is returned as the original file with `drawImage` not called; a 3000×4000 source still goes through the canvas.
  Document the guard in one sentence in architecture 7.1 step 1.
- F3. `docs/tasks.md` T28, third acceptance criterion, and the PR description: the four Kiwi files cannot be bootstrapped after this fix, they are already destroyed; reword to "the Kiwi receipts are re-uploaded from their originals once this task is deployed, get expected JSON through `eval:bootstrap`, and are run through the eval in a follow-up task; the three MENY receipts are the baseline committed here".
  Also note in `eval/README.md`, under "The rule", that the version 2 results files are the first committed baseline, since version 1 never had ground truth.
- F4. Commit the three results files the foreman copies into `eval/results/` (`2026-09-07-v2-kimi-k2.6-nothinking.json`, `2026-09-07-v2-kimi-k2.6-thinking.json`, `2026-09-07-v2-grok-4.6.json`) unchanged, and paste the aggregate table above into the PR description in place of the "Outstanding" paragraph.

## Noted, no action

- `segmentImage` re-encodes each segment at JPEG 85 from a stored JPEG 85, a second-generation loss the model will not notice.
- When the remainder after the last full step is at most the overlap, the final segment is nearly all overlap (121 px tall for a 2001 px image); harmless.
- `toDataUrl` hard-codes `image/jpeg`; correct, because `normaliseImage` always writes JPEG, and `receipt_images.mime_type` is only ever that value.
- `eval/receipts/2026-09-07-kiwi-receipt-7.jpg` and `2026-09-07-receipt-13.jpg` are byte-identical (receipt 7 was deleted and re-uploaded as 13); the foreman will drop the duplicate locally.
