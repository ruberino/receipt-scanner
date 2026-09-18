# Review: T45 — Kvitteringer

Review of pull request #28, commits `f3b3042` (docs) and `11c506a` (implementation) on `task/T45-proposal-size-guard`, 2026-09-18.
Verdict: approved at first pass, no required items.
Reviewed in a separate worktree, per E4.

## What was verified

The ladder is seven rungs, and each one rebuilds the whole context from `input.histories` with tighter limits rather than patching the rung before, so the result stays a pure function of the inputs — the property the old code claimed and this one has. It stops at the first rung that fits, and the test that proves it uses a fixture where nine of twelve purchases fall outside the 12-week window, so the scope rung alone is enough and the purchases rungs are shown not to have run.
`buildProducts` takes `maxPurchases` as a parameter instead of reading the module constant, which is what makes the purchases rungs possible at all; the full-size path passes `MAX_PURCHASES_PER_PRODUCT`, so a context that fits is built exactly as before.
When no rung fits, the most aggressive rung's context is returned rather than nothing — a proposal that costs more is better than no proposal — and that is the only case that warns.
The log carries `step`, `guardChars`, `originalChars`, `finalChars` and both product counts, at `info` on success and `warn` only on failure, and a context that fits logs nothing at all. One test asserts `finalChars` equals `JSON.stringify(context).length` rather than an estimate, which is the part issue #15 was really about.
The constant is 120,000 with the provisional note, the cost sentence and the characters-per-token caveat in the comment, so the next reader finds a number with a date and a reason instead of a third guess.
All five scripts exit 0 in a clean worktree at `11c506a` (Node 24.21.0, 841 tests in 54 files); CI is green on both jobs.
Mutation check reproduced: reverting only `proposalContext.ts` to `main` leaves `6 failed | 14 passed` in `test/server/domain/proposalContext.test.ts`, and the six are the ones the working session named.

## The tiebreak, which was not in the plan

Accepted, and it belongs on this branch rather than in a task of its own.

The old comparator was `(a, b) => (a.lastPurchaseDate < b.lastPurchaseDate ? 1 : -1)`, which answers `-1` in both directions for two products sharing a date. A weekly shop gives dozens of products the same `lastPurchaseDate`, so which 250 survived the cut was decided by the engine's sort algorithm and the order the histories happened to arrive in, not by the data. Stated precisely: the same input on the same Node version gives the same answer, so it was not random — but it was not a function of the inputs either, and it could change under a Node upgrade or a reordered query with nothing in the diff to explain it.

The plan's acceptance criterion says the narrowing is pure and deterministic. Without the tiebreak that criterion would have been satisfied on paper and false in fact, and the rung doing the cutting is exactly where the fix belongs. The test that proves it — 600 products sharing one date, ids 1..250 surviving — fails without the implementation.

## Noted, no action

- `leaves a small context untouched and logs nothing at all` passes with or without the implementation. It is the regression guard for the path that must not change, it was checked and kept deliberately, and the pull request says so rather than counting it among the seven as proof.
- The fixtures are built by computing the serialised size per product rather than by trial and error, and each asserts the rung it stops at, so a fixture that drifts out of its band fails loudly instead of quietly testing a different rung than its name claims. That is the difference between a fixture and a coincidence.
- `FALLBACK_MAX_PRODUCTS` is gone as a named constant; the numbers now live in the ladder where the step that uses them is named. Fewer constants, more legible rungs.

## Go-ahead, 2026-09-18

Approved at `11c506a`: merge with `gh pr merge --rebase --delete-branch`, then `git pull --ff-only`. Issue #15 closes with it.

## Still open after the merge

The measurement this task exists to produce has not been taken: it needs one real proposal against the household's data on the demo, which costs money and touches household rows, so it is Ruben's call whether the foreman runs it or he taps `Foreslå med AI` himself and the numbers are read out of the log.
Either way the answer is one line here: `originalChars` for the household's own context, `promptTokens` from the same call, the ratio between them, and whether the `info` line appears at all — its absence would mean the household now fits at full size, which is the question issue #15 actually asks.
Until that line exists, the constant stays provisional and the note stays in the code.
