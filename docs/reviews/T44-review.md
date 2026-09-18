# Review: T44 — Kvitteringer

Review of pull request #27, commits `551ef34` (docs), `96963dc` (the foreman's E5) and `f4223c1` (implementation) on `task/T44-paste-to-scan`, 2026-09-18.
Verdict: approved at first pass, no required items.
Reviewed in a separate worktree, per E4.

## What was verified

The implementation is one effect and one `||`. `onPaste` reads `event.clipboardData.files`, returns on an empty list, filters to images, shows the shared sentence when something was left out and hands the rest to `enqueueFilesRef.current` — the same entry point the input and the drop use, unchanged. The listener is on `window`, registered once, removed in the cleanup, with `showToast` as the only dependency as in T42.
No `preventDefault`, and the comment says why: nothing on this page would otherwise receive the image, and a paste listener that takes every event is one that breaks a search field the day it outlives its page.
The name fallback is `file.name || 'Limt inn bilde'` inside `enqueueFiles`, with a comment naming the caveat rather than hiding it.
Section 10 states where pasting works — where the browser delivers a clipboard image to the page, desktop and an iPad with a keyboard — and says the iPhone's route is the share sheet. That is the sentence this task was told to write, and it is written as knowledge rather than as a claim.
Scope: `git diff --stat` against `main` touches `src/client/pages/ScanPage.tsx` and nothing else under `src/`; the queue, the downscale, the upload, the drop handling and the overlay are untouched.
`96963dc` is E5 alone, with the co-author line, and the pull request says it is foreman content and not part of the task.
All five scripts exit 0 in a clean worktree at `f4223c1` (Node 24.21.0, 836 tests in 54 files); CI is green on both jobs and `mergeStateStatus` is `CLEAN`.
Mutation check reproduced: reverting only `ScanPage.tsx` to `main` leaves `6 failed | 16 passed` in that file, and all six new tests are among the failures — this task has no test that passes without the code it tests.

## Noted, no action

- The fallback sits inside `enqueueFiles`, so a picked or dropped file with an empty name would also read `Limt inn bilde` — a label naming an origin the code does not know. The alternatives were a parameter on `enqueueFiles` or a second way to build an entry, and the plan rules both out, so the placement is the plan's doing and not a slip. Browsers give picked and dropped files a name, so the wrong label is unreachable in practice. Whoever is next in that function can make it origin-neutral; it is not worth a round trip and three CI runs today, and the working session put it in the pull request's risk section rather than leaving it to be found.
- `pointer-events-none` on the T42 overlay was not added, and the reasoning is right: the permission was scoped to this work bringing the session back into that element, and it did not — `enqueueFiles` and a new effect are not the overlay's JSX, and the file is not the element. A permission read narrowly by the person who would have benefited from reading it widely is worth recording.
- `ignores a paste that carries no files` was, in its first form, a negative assertion that passed against a page with no listener at all — the same fault the T42 review named in that branch's cleanup test, in a different shape one task later. The working session found it with the stash check and rewrote it to paste text, assert nothing, then paste an image and assert it uploads, so it now fails both when the listener is missing and when the filter is wrong. Second task running, the rule has caught something both times.

## Go-ahead, 2026-09-18

Approved at `f4223c1`: merge with `gh pr merge --rebase --delete-branch`, then `git pull --ff-only`.
Expect this commit to reset the checks, and read `gh pr view 27 --json mergeStateStatus` before the refusal text if the merge is held (E5).
