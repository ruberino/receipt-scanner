# Review follow-up: T18 — Kvitteringer

Review of commit `da3959b` (T18) on `task/T18-shopping-list-ui`, 2026-09-07.
Verdict: approved for fast-forward merge after F1.

## What was verified

All five scripts exit 0 in a clean worktree at `da3959b`, 431 tests, Vitest at two workers; the client bundle is 94.0 kB gzip.
With no open list the page shows the suggestions as cards with name, reason and quantity and a `Lag handleliste` button; creating a list writes the response into the current-list query and the page switches to the list view.
The list shows unchecked items first, checked items in a collapsed `N fullført` group, `Fjern` per item, an add field that searches products while open and also adds free text, and `Ferdig handlet` behind a confirmation that returns to the preview by setting the current list to `null`.
The check-off flips local state in the click handler and reverts with a toast on failure, so the checkbox and the group move in the same tick; the reasoning about `onMutate` not being synchronous with the click is correct and matches what the Playwright actionability check reported in T17.
`useCurrentShoppingList` maps the server's 404 to `null` as a success state, and every mutation invalidates or updates the current list.
Fourteen tests cover the two acceptance transitions, the optimistic flip and its revert, add by search and by free text, remove and complete.
Eight screenshots at 360 px cover the whole flow, and both deviations were stated up front this time: the add field has its own combobox because a free-text item does not fit `ProductPicker`, and the third copy of the debounced list is now on record as the extraction candidate.

## F1 — Required before merge: only the 20 px checkbox toggles an item

`03-item-checked.png` shows the row: a small checkbox at the left, the name and reason beside it, `Fjern` at the right.
The task says "tap to toggle", and in a store the thumb lands on the name, not on a 20 px box; the name is not a target at all today.

Steps: in `ShoppingListItemRow`, wrap the checkbox and the text block in a `<label>` with `min-h-11` and `flex-1`, so tapping anywhere on the name, quantity or reason toggles the item; `Fjern` stays a separate button outside the label.
Test: clicking the item's name calls `onToggle`; clicking `Fjern` does not.

## Recommendations, no action now

- `checkedOverride` keeps an entry per toggled item for the life of the view, so a change made on another phone to an item toggled here stays hidden until the page remounts.
  Await the invalidation in the hook's `onSuccess` and clear the override in the row's `onSuccess`, so the server value takes over once the refetch has landed.
- The add field's Enter picks the first search result even when the user typed a different free-text name; Enter should add exactly what is typed unless a result is highlighted.
- Neither view has a heading; the `h1` note stands.

## Done

F1 as one `fix:` commit on the T18 branch, run the five scripts, send the hash, and merge after the go-ahead is recorded here.

## Go-ahead, 2026-09-07

F1 landed as `9420d87`: the checkbox and the text block sit in one `<label>` with `min-h-11` and `flex-1`, `Fjern` stays outside, and the two tests are there.
All five scripts exit 0 in a clean worktree at `9420d87`, 433 tests.
Approved for fast-forward merge.
With T18 every page of the MVP is real; the order from here is T21 (Docker, Litestream, Render, restore drill), T22 (CI), T20 (extraction eval), T23 (phase 2), because a stable deployment matters more to Ruben's phone testing than the eval harness while no prompt change is planned.
