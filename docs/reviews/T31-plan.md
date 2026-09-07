# T31 plan — Kvitteringer: nothing on the shopping list is lost to a wrong tap

Foreman's task definition, 2026-09-07, from Ruben's request to rework the shopping list ("vanskelig å gå tilbake hvis man har trykket feil").
Ruben's decisions, asked and answered the same day: undo through a toast and visible checked items rather than confirmation dialogs; a completed list can be reopened and a mistaken list deleted.
This is the first of two tasks; T32 (`docs/reviews/T32-plan.md`) does the grouping, editing and header.
Order: after T30 merges.
Branch `task/T31-shopping-list-undo`, pull request per AGENTS.md, docs commit first.

## The problem in one paragraph

Every destructive action on `/` is one tap with no way back: `Fjern` deletes an item at once, a checked item vanishes into a collapsed `n fullført` group, `Ferdig handlet` closes the list for good, and a list created by mistake cannot be removed.
The API has the pieces for everything except reopening and deleting a list.

## API

- `POST /api/shopping-lists/:id/reopen`: `200 ShoppingList`.
  Allowed when the list is `done`, its `completedAt` falls on today's date in Europe/Oslo (`todayInOslo`), and no list is `open`; sets `status = 'open'` and `completedAt = null`.
  Otherwise `409` with `Listen kan ikke gjenåpnes`; `404` when missing.
  The one-open-list invariant in architecture section 6 stays enforced in code, here too.
- `DELETE /api/shopping-lists/:id`: `204` when the list is `open` (items cascade); `409` with `En fullført liste kan ikke slettes` when `done`; `404` when missing.
  History is never deleted from the app.
- `GET /api/shopping-lists?limit=1` already returns the latest list; the client uses it to offer `Gjenåpne` on the preview.
  No new read endpoint.

## Client

- `Toast.tsx` gains an optional action: `showToast(text, { actionLabel, onAction })`.
  A toast with an action stays 6 s instead of 3 s and renders the action as a 44 px button inside the toast; `onAction` dismisses the toast.
  Showing a new toast replaces the current one, as today.
- Removing an item is deferred, so the row comes back exactly as it was, with its `reason` and `source`.
  Tapping `Fjern` hides the row at once and shows `«Lettmelk 1 l» fjernet` with `Angre`.
  `Angre` unhides the row and nothing is sent.
  When the 6 s pass, when a second item is removed, or when `OpenListView` unmounts, the pending `DELETE /api/shopping-list-items/:id` is sent; only one removal is pending at a time.
  A failed `DELETE` unhides the row and shows the error toast, as today.
  If the app is closed inside the 6 s the item simply stays; say so in one sentence in architecture section 10.
- Checked items are visible: the `<details>` group goes away, and checked items sit in a plain `Kjøpt (n)` section at the bottom of the list, struck through, with the same checkbox, so one tap unchecks.
  Unchecked items keep today's order until T32 groups them.
- `Ferdig handlet` completes at once, without `window.confirm`, and shows `Handleturen er fullført` with `Angre`, which calls `reopen`.
  The suggestions preview shows, above `Lag handleliste`, `Handleturen ble fullført kl. 14:12` and a `Gjenåpne listen` button (44 px) when the latest list is `done` and its `completedAt` is today in Oslo; the button calls `reopen` and the page shows the open list again.
- `Slett listen`: a red text button under `Ferdig handlet`, behind `window.confirm('Slette handlelisten? Dette kan ikke angres.')`, calling the new `DELETE`; on success the preview shows.
  This one keeps a confirmation because there is no undo for it.
- New hooks in `queries.ts`: `useReopenShoppingList`, `useDeleteShoppingList`, `useLatestShoppingList` (the `limit=1` history call); all invalidate `['shopping-list']`, `['shopping-lists']` and `['suggestions']`.

## Docs commit

- `docs/architecture.md`: the two new API rows; the `/` row in section 10 rewritten: "The open list with check-off, a visible `Kjøpt (n)` section, add item, remove item with a 6 s `Angre` (the delete is sent when the toast expires, so an item removed just before the app is closed stays), `Ferdig handlet` with `Angre` that reopens, `Slett listen` behind a confirmation; when there is no open list, a preview of suggestions, `Lag handleliste`, and `Gjenåpne listen` when the latest list was completed today"; the UI-behaviour bullet about optimistic checking gains the deferred-removal sentence.
- `docs/tasks.md`, append:

```
## T31 — Nothing on the shopping list is lost to a wrong tap

Goal: every one-tap action on the shopping list can be undone, and a list can be reopened or deleted.

Files: `src/server/routes/shoppingLists.ts`, `src/shared/schemas.ts` (no shape change), `src/client/components/Toast.tsx`, `src/client/pages/ShoppingListPage.tsx`, `src/client/components/ShoppingListItemRow.tsx`, `src/client/api/queries.ts`, tests.

Steps: see `docs/reviews/T31-plan.md`.

Acceptance criteria:

- Tapping `Fjern` hides the item and shows `Angre` for 6 s; `Angre` brings the row back unchanged with nothing sent; after 6 s the item is deleted on the server.
- A checked item stays visible under `Kjøpt (n)` and one tap unchecks it.
- `Ferdig handlet` completes at once; `Angre` in the toast reopens the list with all items and their checked state intact.
- With no open list and the latest list completed today, the preview offers `Gjenåpne listen`; tomorrow it does not.
- `Slett listen` deletes an open list after confirmation and never a completed one.
- Every action is possible with 44 px targets at 360 px width; Playwright walk with screenshots under `docs/reviews/screenshots/T31/`.

Tests: route tests for reopen (today, yesterday, another list open, 404, 401) and delete (open, done, 404, 401); client tests with fake timers for remove-and-undo, remove-and-expire, a second removal flushing the first, unmount flushing; complete-and-undo; the preview with and without `Gjenåpne`; delete list confirmed and dismissed; the `Kjøpt` section.
```

## Gate

Pull request, send the number and head SHA; merge after the go-ahead is recorded in `docs/reviews/T31-review.md`.
