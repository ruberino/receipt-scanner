# Review follow-up: T19 — Kvitteringer

Review of commit `f082d79` (T19) on `task/T19-receipts-list`, 2026-09-06.
Verdict: approved for fast-forward merge after F1.

## What was verified

All five scripts exit 0 in a clean worktree at `f082d79`, 391 tests, Vitest at two workers.
`ReceiptsPage` lists newest first with store, relative date, `formatOre` total, status badge and `1 varsel` or `n varsler`, links every row to its receipt, shows `Skann` on `uploaded` rows and `Skann (1)` or `Skann alle (n)` above the list, both through `POST /api/receipts/:id/scan`, and pages with `Last flere` on the `before` cursor through `useInfiniteQuery`.
The list polls every 2 s only while a loaded receipt is `pending` or `processing`; `receiptsListRefetchInterval` is tested both ways.
The manifest has name, `short_name`, `start_url`, `scope`, `display: standalone`, colours, `lang: nb` and the 192 and 512 px icons; `index.html` has `viewport-fit=cover`, `theme-color`, the manifest link, the apple touch icon and the three `apple-mobile-web-app-*` tags; the bottom navigation, the main padding and the toast account for `env(safe-area-inset-bottom)`.
Installability was checked against the production build with the DevTools protocol calls `Page.getInstallabilityErrors` and `Page.getAppManifest`, both clean; that is the acceptance criterion's Manifest pane, done properly.
Twelve screenshots at 360 and 1280 px show no horizontal overflow and 44 px targets.
Thirteen tests cover the states, the row link, `Skann`, `Skann alle`, the toast on failure and both pagination cases.

The Android and iOS installation checks need a real phone and are recorded as pending for Ruben, as in the sibling's T12.

## F1 — Required before merge: uploaded and failed rows are indistinguishable

`mobile-receipts.png` shows five rows reading `Ukjent butikk` and `–`, two of them `Lastet opp` and two `Feilet`; the user cannot tell which photo is which, and `Ukjent butikk` is wrong for a receipt nobody has read yet.

Steps: for rows without `storeName`, show `Ikke skannet ennå` when `uploaded`, `Lesing feilet` when `failed`, and `Ukjent butikk` only when `done`; for rows without `purchasedAt`, show `Lastet opp ` followed by `formatRelativeDate(createdAt)` instead of `–`.
Tests: one `uploaded` and one `done` row without store render the two different first lines, and a row without `purchasedAt` shows the upload date.

## Recommendations, no action now

- `Skann alle` re-enables between the sequential calls, so a second tap mid-loop sends duplicate scans that answer `409`; a local `isScanningAll` flag around the loop closes it, here and on `ScanPage`.
- Chrome logs a deprecation warning for `apple-mobile-web-app-capable` unless `mobile-web-app-capable` is present too; add the second tag.
- Neither the list nor the receipt page has a heading; an `h1` per page helps orientation and screen readers.

## Pending for Ruben

Chrome on Android offers `Installer app` for the served build, and iOS Safari's `Legg til på Hjem-skjerm` opens standalone without browser chrome; record the result here when done.

## Done

F1 as one `fix:` commit on the T19 branch, run the five scripts, send the hash, and merge after the go-ahead is recorded here.
