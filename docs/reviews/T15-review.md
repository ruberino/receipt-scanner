# Review follow-up: T15 — Kvitteringer

Review of commit `2cd58cf` (T15) on `task/T15-scan-flow`, 2026-09-06.
Verdict: approved for fast-forward merge after F1 and F2.

## What was verified

All five scripts exit 0 on the branch; 346 tests pass; nothing under `src/client` imports from `src/server`.
`computeDownscaledSize` is pure and tested on landscape, portrait, within-limit and at-limit inputs; `downscaleImage` uses `createImageBitmap` with an `Image` fallback, returns the original for a JPEG under 500 KB that is within the limit, otherwise redraws at quality 0.85 and releases the bitmap or object URL; the canvas is mocked in eight tests, including 4000 × 3000 becoming 2000 × 1500.
`ScanPage` has the two hidden inputs (`capture="environment"` and none) behind `Ta bilde` and `Velg fra bilder`, a preview whose object URL is revoked, `Bruk` downscaling then uploading with a progress bar, navigation to `/receipts/:id` on success, the toast `Denne kvitteringen er allerede skannet` plus navigation to `details.existingReceiptId` on 409, and the server message for other 4xx; the 400 and 413 paths are tested.
`ReceiptPage` shows the thumbnail, a spinner and elapsed seconds while `pending` or `processing`, with the counter in a child component that resets by remounting, and the error message with `Prøv igjen` when `failed`.
`receiptRefetchInterval` returns 2 000 ms only for `pending` and `processing`, `useReceipt` delegates to it, and the function is tested directly.

## F1 — Required before merge: drive the flow in a headless browser and keep the screenshots

The commit says the environment has no browser tool.
It does: `npx playwright --version` in this repository prints 1.63.0, and the sibling app has used it since T07 to walk every page at 360 px and catch defects the component tests could not see, such as an unpositioned toast.
Claims about the environment need the same verification as claims about code.

Steps: build and run the production image or `npm start` against a scratch database, log in with Playwright at 360 × 780, open `/scan`, set the file input to `test/fixtures/images/receipt-small.jpg`, and capture the preview, the progress state and the resulting receipt page (`failed` is expected without a valid Kimi key, and is a fine screenshot).
Save the PNGs under `docs/reviews/screenshots/T15/` and fix anything that looks off before merging.
From here on, every UI task (T16 to T19) ships with such a walk.

## F2 — Required before merge: the progress bar is readable by assistive technology

The `role="progressbar"` element carries no value.
Add `aria-valuemin={0}`, `aria-valuemax={100}` and `aria-valuenow={Math.round(progress * 100)}`, and assert `aria-valuenow` reaches 100 in the upload test, which also makes the "progress reaches 100 %" acceptance bullet explicit.

## Done

F1 and F2 as one commit on the T15 branch, then fast-forward merge and send the hash.
