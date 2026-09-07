# Review: T30 — Kvitteringer

Review of pull request #7, commits `5c9fd1e` (docs) and `3620de3` (implementation) on `task/T30-delete-failed-receipt`, 2026-09-07.
Verdict: approved for merge, no required items.

## What was verified

`ProcessingView` derives the seconds from the server's `updatedAt`, recomputes them every second instead of incrementing a counter (so no drift), clamps at 0 for clock skew, and is keyed on `updatedAt` at the call site so the `pending → processing` transition restarts it honestly with the label switching from `I kø…` to `Leser kvittering…`.
`ReceiptSummary` gains `updatedAt` from the existing column; the `toReceiptSummary` test asserts it is distinct from `createdAt`.
`DeleteReceiptButton` is the one delete handler for the `uploaded`, `failed` and `done` views; the two older copies are gone.
The deviation the PR flags is right: the `Kvitteringen er slettet` toast now shows on every path, which is what one shared component should do, and the plan only ever asked for it on the failed view because that was the view being added.
Tests cover the elapsed time against a faked clock, the pending label, the same time after a remount, the clamp at 0, and delete after confirmation and after dismissal on the failed view.
Screenshots: the failed view has the red-outline `Slett kvittering` under `Prøv igjen`, the processing view reads `Leser kvittering… (71 s)`; both at 360 px.
Architecture section 9 type and section 10 row and the tasks.md entry follow the plan; the plan file is unchanged.

## Noted, no action

- A phone whose clock is ahead of the server shows a slightly larger number; behind, the clamp hides it.
  Not worth a server-side "now" in the response.

## Go-ahead, 2026-09-07

All five scripts exit 0 in a clean worktree at `3620de3`, 550 tests, Vitest at two workers; CI run 34120297344 is green on both jobs.
Approved: commit this file on the branch, push, wait for green, merge with `gh pr merge --rebase --delete-branch`, `git pull --ff-only`.
After the merge the foreman updates the demo.
T35 is next, then T33, T31, T32, T34.
