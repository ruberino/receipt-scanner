# Review: T42 — Kvitteringer

Review of pull request #26, commits `2b6b80d` (docs) and `b544f0c` (implementation) on `task/T42-drop-to-scan`, 2026-09-18.
Verdict at first pass: one required item (F1), a single line in the release checklist; the implementation is built to the plan and the tests are honest about what they cannot prove.
Reviewed in a separate worktree, per E4.

## What was verified

One entry point: `enqueueFiles(files: File[])` holds the whole body that `handleFilesSelected` used to, the input handler now only unwraps `event.target.files` and clears the input, and the drop handler calls the same function through a ref. No second queue, no second downscale, no second upload.
The listeners are on `window`, registered once, removed in the effect's cleanup, and the effect's only dependency is `showToast`, which `Toast.tsx` memoises with `useCallback` — so the registration does not churn on every render while the ref keeps the handlers current.
`carriesFiles` reads `dataTransfer.types`, which a browser leaves readable in the protected mode a drag imposes, unlike `files`; a drag of selected text is ignored on all four events.
The depth counter is incremented on enter and decremented on leave with a `Math.max(0, …)` floor, so the enter/leave pair from crossing a child cannot drive it negative and strand the overlay.
`dragover` and `drop` both call `preventDefault()`, and only when files are coming.
The overlay is rendered conditionally, so it is absent from the DOM when nothing is dragged — the acceptance criterion this task was given, and the one that matters on a phone.
Scope: `git diff --stat` against `main` touches `src/client/pages/ScanPage.tsx` and nothing else under `src/`; the queue, the per-file states, the downscale and the upload are untouched, and the `/scan` row in section 10 describes the drop, the toast and the overlay.
All five scripts exit 0 in a clean worktree at `b544f0c` (Node 24.21.0, 830 tests in 54 files); CI is green on both jobs.
The mutation check reproduced: reverting only `ScanPage.tsx` to `main` leaves `7 failed | 9 passed` in that file, and the seven are the ones the working session named.

## Required before merge

- F1. The one failure this feature can have is the one nothing here can test, so it belongs on the checklist a human runs.
  `preventDefault` on `dragover` is asserted through `defaultPrevented` on a dispatched event. That proves the handler took the event; it does not prove the browser then declines to open the file and navigate away from the app, and no test in this repository can — a synthetic drop is an untrusted event, so it does not trigger the default action even in a real browser, and a drag out of the OS file manager cannot be scripted at all.
  Add to `docs/release-checklist.md`, next to the other by-hand checks: `- [ ] Drag a receipt image from the file manager onto /scan and confirm it uploads, and that the browser does not open the image instead.`
  Nothing else; the working session already put the limit in the pull request rather than letting the assertion stand in for the real thing, which is why this is a line in a checklist and not a finding.

## Noted, no action

- The overlay does not set `pointer-events-none`. It has nothing interactive in it, and with the pointer events off it the depth counter could not be affected by the overlay's own insertion under the cursor at all. Browsers pair the enter and leave when the element under the pointer changes, and a cancelled drag fires `dragleave` at the current target before it ends, so the counter does return to zero as written — this is insurance for whoever edits it next, not a defect.
- The eighth test, `ignores a drag that carries no files`, passes with or without the implementation. It is a negative assertion against a page that does nothing, kept as a guard against the listeners over-reaching later, and the pull request says so instead of counting it among the eight as if it proved something. Right on both counts.
- The cleanup test in its first form — unmount, drop, assert nothing happened — also passed without the implementation, and the working session found that with the stash check and rewrote it to drop once before and once after the unmount. That is the rule earning its keep in its second task, and it is worth saying so here.
- Clipboard paste falls out of the same `enqueueFiles` and is the useful sibling on a phone, where there is no drag at all. Noted as a follow-up in the pull request; it gets its own task.

## Go-ahead, 2026-09-18

F1 verified at `4e93d06`: the line is verbatim, it sits directly under `Scan a receipt from a phone camera.` so the two scan checks stand together, and `docs/release-checklist.md` is the only file in the commit — no code moved for a checklist line, which is what a second pass is for.
CI is green on both jobs at that commit.
Approved: merge with `gh pr merge --rebase --delete-branch`, then `git pull --ff-only`.
Expect one more CI run first: this go-ahead is itself a commit and resets the requirement, and the checks take about half a minute to register on a new head before they start reporting.
