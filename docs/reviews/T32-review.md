# Review: T32 — Kvitteringer

Review of pull request #12, commits `0a2efe3` (docs) and `cc7a472` (implementation) on `task/T32-shopping-list-layout`, 2026-09-07.
Verdict at first pass: one required item (F1), and it corrects the foreman's own plan; everything else is right.
Second pass on `a7e911c`: F1 is done; approved, see the go-ahead at the end.

## What was verified

Server: `category` comes from a left join on `products` in the list read and from a lookup in the two single-item endpoints, derived and never stored; the schema and the architecture type carry it as `string | null`.
`SHOPPING_CATEGORY_ORDER` is declared with `satisfies readonly ProductCategory[]` and a test proves it is a permutation of `PRODUCT_CATEGORIES`.
Client: header with the ISO week of `weekStart` and live `x av n kjøpt`; unchecked items grouped in store-walk order, alphabetical within a group with the `nb` collator, `null` category under `Annet`, empty groups not rendered; the `Kjøpt (n)` section stays flat; inline editing sends only the changed fields, rejects an empty name inline, sends `quantityText: null` when the field is cleared, and never touches `checked`, `productId` or `category`; the remove control is a 44×44 px `×` with the aria-label; the page is centred at `max-w-2xl`; the suggestion card is two lines.
Tests: grouping and fallback, sort order, header, the edit cases, the server join and the permutation; the T31 behaviours re-verified against the new row.
Screenshots at 360 px show the grouped list with headings and the inline editor, and at 1280 px the centred layout.
Docs: repository layout, the type, both item API rows and the `/` row follow the plan; the plan file is unchanged.
CI is green on `cc7a472`.

## Required before merge

- F1. The row's primary tap must check the item off, not open the editor.
  The plan said "tapping an item's text opens inline editing", and the agent rightly flagged that this replaces the tap-to-toggle behaviour T18 F1 established; on reflection the plan was wrong for the store: checking off is the action done twenty times per trip, one-handed, and it deserves the whole row as its target, while editing happens once in a while.
  Change: the text becomes part of the checkbox label again (the row toggles, as before T32); editing opens from a dedicated 44×44 px pencil icon button between the text and the `×`, with `aria-label="Rediger {name}"`.
  Tests: restore the tap-on-name-toggles test (it may keep its T18 F1 name) and point the open-edit test at the pencil button; retake the 360 px grouped-list screenshot.
  The architecture `/` row changes "tap an item's text to edit" to "a pencil button on each item edits name and quantity in place"; the foreman corrects the plan file the same way in this commit.

## Noted, no action

- `position` is still written and returned; the UI no longer orders by it, as the plan says.
  T34 appends new items after the maximum position, which is harmless under grouping.

## Go-ahead, 2026-09-07

F1 verified at `a7e911c`: the checkbox label wraps the text again so the row toggles, the pencil button carries `Rediger {name}` and opens the editor, the T18 F1 test is back and the open-edit test targets the pencil, the screenshots show pencil and `×` on every row, and the plan file and the architecture `/` row carry the correction.
All five scripts exit 0 in a clean worktree at `a7e911c`, 601 tests, Vitest at two workers; CI is green on both jobs.
Approved: re-read this file, commit it on the branch, push, wait for green, merge with `gh pr merge --rebase --delete-branch`, `git pull --ff-only`.
After the merge the foreman updates the demo once its scan queue is empty.
T34 is next, then T37.
