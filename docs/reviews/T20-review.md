# Review follow-up: T20 — Kvitteringer

Review of commit `64b48fa` (T20) on `task/T20-extraction-eval`, 2026-09-07.
Verdict: approved for fast-forward merge after F1.

## What was verified

All five scripts exit 0 in a clean worktree at `64b48fa`, 465 tests, Vitest at two workers.
`eval/metrics.ts` has the six metrics from the task with one greedy normalized-text matcher shared by `itemRecall` and `priceAccuracy`, øre rounding for prices, containment for the store, `±1` NOK for the total, a signed line-count difference and the aggregate with rates and means; 25 unit tests on hand-made pairs.
`eval/run.ts` pairs each photo with `<photo>.expected.json`, skips photos without one, downscales through the same `normaliseImage` pipeline as an upload, times `runExtraction`, prints a table and the aggregate, and writes `eval/results/<date>-v<promptVersion>-<model>.json` with numbers and booleans only; the orchestration test asserts the written file never contains the fixture's store or item text.
`bootstrapExpected` writes `<photo>.expected.draft.json` from one extraction, and the pairing matches the exact `.expected.json` suffix only, so a draft is never ground truth; tested.
`eval/README.md` documents the expected-JSON shape, the draft step, the six metrics, the regression rule and the privacy contract; `eval/results/.gitkeep` is tracked; `tsconfig.server.json` typechecks `eval` and `test/eval`.
No test or CI path reaches Kimi; the real run and the first results file wait for Ruben.

## F1 — Required before merge: `npm run eval:extraction` does nothing on Windows

Reproduced in the worktree on this machine: `npx tsx eval/run.ts` exits 0 with no output.
The guard compares `import.meta.url` with `` `file://${process.argv[1]}` ``; on Windows `process.argv[1]` is `C:\code\…\eval\run.ts`, so the right-hand side is `file://C:\code\…` while `import.meta.url` is `file:///C:/code/…`, and `main()` never runs.
Ruben runs the eval from this Windows machine, so as committed the harness cannot be run by the one person who has the key.

Steps:

1. `import { pathToFileURL } from 'node:url'` and compare with `pathToFileURL(process.argv[1]).href`.
2. Build the real `KimiClient` lazily, only when there is at least one photo with expected JSON or in bootstrap mode, so `npm run eval:extraction` on an empty set prints `nothing to run` without needing any environment.
3. Verify by running `npm run eval:extraction` here with no `.env` and no pairs: it must print the `nothing to run` line and exit 0; paste that line in the commit body.

## Pending for Ruben

Supply the key in `.env`, run `npm run eval:bootstrap -- eval/receipts/2026-09-06-kiwi-56-lines.jpg`, correct the draft against the paper receipt and rename it to `.expected.json`, add at least nine more receipts from different stores the same way, then run `npm run eval:extraction` and commit the first results file as the baseline.

## Done

F1 as one `fix:` commit on the T20 branch, run the five scripts, send the hash, and merge after the go-ahead is recorded here.
T23 (phase 2 statistics and list history) is next and last in the list.

## Go-ahead, 2026-09-07

F1 landed as `b2400e6`: the guard compares with `pathToFileURL(process.argv[1]).href`, and the real client is built only when there is a pair or in bootstrap mode.
Verified in the worktree on this Windows machine with no `.env` and no pairs: `npx tsx eval/run.ts` prints the `nothing to run` line and exits 0, which it did not before; lint, typecheck and format pass at `455480a`, tests unchanged at 465.
Approved for fast-forward merge.
