# Review: T34 — Kvitteringer

Review of pull request #13, commits `0ad745d` (docs) and `9fcadee` (implementation) on `task/T34-refresh-suggestions`, 2026-09-07.
Verdict: approved for merge, no required items.

## What was verified

Migration `0002` is a plain `CREATE TABLE shopping_list_dismissals` with the composite primary key and both cascades, no table recreate; a new `0001-only` fixture proves an existing open list and its items survive the migration with their ids, and a test proves that deleting a list or a product cascades its dismissals.
`DELETE /api/shopping-list-items/:id` writes the dismissal in the same transaction as the delete, `onConflictDoNothing` on the primary key, and only when the item has a `product_id`.
`POST /api/shopping-lists/:id/refresh` runs the engine against today in Oslo, skips products already on the list (checked or not) and dismissed products, appends after the current maximum position in one transaction, and returns the list; 401, 404 and 409 are tested, as are add, idempotent second call, skip-when-checked, never-re-add-dismissed and position.
Client: `Oppdater forslag` between `Legg til vare` and `Ferdig handlet`, disabled while pending; the hook sets the current-list cache from the response and invalidates suggestions; the toast is `1 vare lagt til`, `n varer lagt til` or `Ingen nye forslag` from an id diff against the cached list; error toast on failure.
ADR-0008 carries the snapshot-versus-live amendment; section 6 has the table and the invariant, section 9 the route, section 10 the button.
Screenshots at 360 px show the list before, after with `1 vare lagt til` and the new item in its category group, and the `Ingen nye forslag` toast.
CI is green on `9fcadee`.

## Noted, no action

- `reason` and `quantityText` on items already on the list are not refreshed, as the plan decided; a stale reason on an old item is accepted.
