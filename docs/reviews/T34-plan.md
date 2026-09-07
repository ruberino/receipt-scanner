# T34 plan — Kvitteringer: refresh the open shopping list with new suggestions

Foreman's task definition, 2026-09-07, approved by Ruben ("ja") after the explanation that suggestions are computed live but a list is a snapshot taken when it is created.
Order: after T32 merges.
Branch `task/T34-refresh-suggestions`, pull request per AGENTS.md, docs commit first.

## The change in one paragraph

An open list gets an `Oppdater forslag` button that adds every product the suggestion engine proposes today and that is not already on the list, without touching what the user added, checked or removed.
Removed suggestions stay removed: deleting an item that points at a product records a dismissal for that list, and a refresh never re-adds a dismissed product.

## Data

- New table `shopping_list_dismissals (list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (list_id, product_id))`, through a drizzle migration (`npm run db:generate`); the migration runner already turns foreign keys off around `migrate()` (T24), verify the generated SQL is a plain `CREATE TABLE`.
- `DELETE /api/shopping-list-items/:id` inserts a dismissal `(list_id, product_id)` when the deleted item has a `product_id`, in the same transaction, `INSERT OR IGNORE`.
  A manual item without a product leaves no trace.

## API

- `POST /api/shopping-lists/:id/refresh`: `200 ShoppingList`.
  Only when the list is `open`, else `409` with `Listen er ikke åpen`; `404` when missing.
  Computes `computeSuggestions(loadProductHistories(db), todayInOslo(now()))`, then, in one transaction, inserts every suggestion whose `productId` is on neither the list's items (checked or not) nor its dismissals, as `source = 'suggested'` with `reason` and `quantityText`, `position` after the current maximum, in suggestion order.
  Existing items are not updated; a stale `reason` on an old item is accepted.
- `POST /api/shopping-lists` (create) is unchanged.

## Client

- `Oppdater forslag`: a secondary 44 px button placed with `Legg til vare` at the bottom of the open list (T31/T32 layout), disabled while pending.
- On success the client diffs item ids against the list it had in the query cache and shows `3 varer lagt til`, `1 vare lagt til` or `Ingen nye forslag`; new items appear in their category groups (T32).
- Hook `useRefreshShoppingList(listId)` in `queries.ts`, setting the current-list cache from the response and invalidating `['suggestions']`.

## Docs commit

- `docs/architecture.md`: section 6 gains the table and the invariant "a product dismissed from a list is never re-added to that list by a refresh"; the API row; the `/` row in section 10 gains `Oppdater forslag`; ADR-0008 gets a short amendment: the engine stays pure and live, a list is a snapshot, and refresh is the explicit bridge between the two.
- `docs/tasks.md`, append:

```
## T34 — Refresh the open shopping list with new suggestions

Goal: a list made on Friday can pick up what became due after the weekend's receipts, without losing the user's own edits.

Files: `src/server/db/schema.ts`, a migration, `src/server/routes/shoppingLists.ts`, `src/client/pages/ShoppingListPage.tsx`, `src/client/api/queries.ts`, tests.

Steps: see `docs/reviews/T34-plan.md`.

Acceptance criteria:

- After a new receipt makes a product due, `Oppdater forslag` adds it to the open list once; pressing again adds nothing and says `Ingen nye forslag`.
- A suggested product the user removed from the list is not re-added by a refresh; the same product is suggested again on the next list.
- Checked items and manual items are untouched by a refresh.
- The button is 44 px at 360 px width; screenshots under `docs/reviews/screenshots/T34/`.

Tests: route tests for adds-missing, skips-present-including-checked, skips-dismissed, appends-after-max-position, 409 when done, 404, 401; the dismissal is written on item delete with a product and not without; migration test that existing lists and items survive; client test for the three toast texts.
```

## Gate

Pull request, send the number and head SHA; merge after the go-ahead is recorded in `docs/reviews/T34-review.md`.
