# Review: T31 — Kvitteringer

Review of pull request #10, commits `16135be` (docs) and `37baa54` (implementation) on `task/T31-shopping-list-undo`, 2026-09-07.
Verdict at first pass: one required item (F1); the deferred-removal design, the reopen and delete endpoints and the visible `Kjøpt` section are right.
Second pass on `20b4400`: F1 is done; approved, see the go-ahead at the end.

## What was verified

Server: `reopen` requires `done`, `completedAt` on today's Oslo date and no open list, and clears `completedAt`; `DELETE` requires `open` and cascades the items; both have 401, 404 and every 409 case tested, including a completion just after midnight Oslo time whose UTC date is still yesterday, the same class of bug T33 fixed and here caught before it shipped.
Client: one pending removal at a time held in a ref, the row hidden through state, `Angre` restores it with nothing sent, the delete goes out on timeout, on a second removal and on unmount, a failed delete unhides the row with the error toast; the toast's action button is 44 px and an action toast stays 6 s while a plain one keeps 3 s; `Ferdig handlet` completes at once and offers `Angre` that reopens; the preview offers `Gjenåpne listen` with the Oslo completion time only when the latest list was completed today; `Slett listen` sits behind a confirmation as the one action without an undo.
The empty-deps unmount effect is justified in the comment: the cleanup reads the ref at call time, and an exhaustive-deps version would flush on every render.
Tests: 30 new, covering every acceptance criterion with fake timers, plus the Toast durations and the unmount flush.
Screenshots: the open list with `Kjøpt (1)` visible and `Slett listen` below `Ferdig handlet`, the `«Grovbrød» fjernet · Angre` toast, the completion toast, the preview with `Handleturen ble fullført kl. 15:24` and `Gjenåpne listen`, and the preview after a delete.
Docs: the two API rows, the `/` row and the UI-behaviour bullet follow the plan; the T33 go-ahead addendum that missed PR #9 is in the docs commit as agreed; the plan file is unchanged.
CI is green on `37baa54`.

## Required before merge

- F1. A pending removal must not outlive the list it belongs to.
  Today, `Fjern` on an item and then `Ferdig handlet` within 6 s completes the list, the view unmounts, the flush sends the `DELETE` against a `done` list, the server answers `409`, and the error toast replaces the `Handleturen er fullført · Angre` toast, so the undo for the completion is gone.
  `Slett listen` inside the window has the same race against a list that no longer exists.
  Fix: `handleComplete` calls `sendPendingRemoval()` first, so the item is deleted while the list is still open and the completion follows; `handleDeleteList` cancels the pending removal instead (clear the timeout, null the ref, nothing sent), because the cascade removes the item anyway.
  Tests: remove then complete within the window sends the item delete before the complete call and shows only the completion toast; remove then delete the list sends no item delete.

## Noted, no action

- The completion toast's `Angre` calls the `reopen` mutation owned by `OpenListView`, which has unmounted by the time the user taps it.
  The reopen still runs and the hook-level `onSuccess` still invalidates the queries, so the list comes back; only the per-call error toast would be lost, and the only way that call fails right after a completion is a second open list, which cannot exist.
  If this ever needs to be tightened, the mutation belongs in `ShoppingListPage`, which stays mounted.
- `useReopenShoppingList(latestList?.id ?? -1)` in the preview is only enabled once the latest list is loaded and completed today; the placeholder id is never sent.

## Go-ahead, 2026-09-07

F1 verified at `20b4400`: `handleComplete` flushes the pending removal first, `handleDeleteList` cancels it, and the two tests pin the call order and the absence of the item delete.
All five scripts exit 0 in a clean worktree at `20b4400`, 585 tests, Vitest at two workers; CI is green on both jobs.
Approved: re-read this file, commit it on the branch, push, wait for green, merge with `gh pr merge --rebase --delete-branch`, `git pull --ff-only`.
After the merge the foreman updates the demo once its scan queue is empty.
T36 is next, then T32, T34, T37.
