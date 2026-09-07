# T32 plan — Kvitteringer: a shopping list that reads well in the store

Foreman's task definition, 2026-09-07, the second half of Ruben's shopping list rework ("rework, designmessig og funksjonelt").
Ruben's decisions: items grouped by category in store-walk order; name and quantity editable in place.
Order: after T31 merges.
Branch `task/T32-shopping-list-layout`, pull request per AGENTS.md, docs commit first.

## The change in one paragraph

The open list gets a header with the week and progress, its unchecked items are grouped under category headings in the order one walks through a grocery store, each item can be edited in place, and `Fjern` becomes a quiet icon instead of red text on every row.
The `Kjøpt (n)` section from T31 stays flat at the bottom.

## API

- `ShoppingListItem` gains `category: ProductCategory | null`: the product's category when `productId` is set, `null` otherwise.
  `shoppingLists.ts` joins `products` when building the list; `POST items` and `PATCH` return it too.
  No migration; the value is derived.

## Client

- `src/shared/categories.ts` gains `SHOPPING_CATEGORY_ORDER`, the store-walk order: `Frukt og grønt`, `Brød og bakevarer`, `Meieri`, `Kjøtt og fisk`, `Tørrvarer`, `Frossen`, `Drikke`, `Snacks`, `Husholdning`, `Hygiene`, `Annet`; a test asserts it is a permutation of `PRODUCT_CATEGORIES`.
- Header at the top of the open list: `Handleliste uke 37` (ISO week of `weekStart` through `src/shared/dates.ts`) and `3 av 18 kjøpt`; the same header, without progress, on the preview: `Forslag til uke 37`.
- Unchecked items grouped by `category ?? 'Annet'` in `SHOPPING_CATEGORY_ORDER`, alphabetical within a group by `localeCompare(…, 'nb')`; a group heading is small grey uppercase text; empty groups are not rendered.
  The `position` column is kept and untouched; the UI no longer orders by it.
- Tapping an item's text opens inline editing: `Navn` (text) and `Antall` (text, e.g. `2 stk`, `1 kg`, may be empty), `Lagre` and `Avbryt`, 44 px each.
  `Lagre` sends only the changed fields through `PATCH /api/shopping-list-items/:id`; an empty name shows `Navnet kan ikke være tomt` inline and sends nothing; success shows `Varen er oppdatert`.
  Editing does not change `checked`, `productId` or `category`.
- `Fjern` becomes a 44×44 px icon button (an ×) with `aria-label="Fjern {name}"`, grey, right-aligned; the T31 undo behaviour is unchanged.
- The suggestion cards on the preview shrink to one line each: name, then the reason in grey; the quantity moves to the end of the first line.
- Desktop: the page keeps the 360 px flow but caps at `max-w-2xl` centred, like the other pages (T19).

## Docs commit

- `docs/architecture.md`: the `ShoppingListItem` type in section 9 gains `category`; the `/` row in section 10 gains "header with week and progress; unchecked items grouped by category in store-walk order; tap an item's text to edit name and quantity"; the repository layout entry for `categories.ts` mentions `SHOPPING_CATEGORY_ORDER`.
- `docs/tasks.md`, append:

```
## T32 — A shopping list that reads well in the store

Goal: the list is grouped the way the store is laid out, shows where you are, and lets you fix an item without removing it.

Files: `src/shared/categories.ts`, `src/shared/schemas.ts`, `src/server/routes/shoppingLists.ts`, `src/client/pages/ShoppingListPage.tsx`, `src/client/components/ShoppingListItemRow.tsx`, `src/client/components/SuggestionCard.tsx`, tests.

Steps: see `docs/reviews/T32-plan.md`.

Acceptance criteria:

- Items appear under category headings in `SHOPPING_CATEGORY_ORDER`; a manual item without a product is under `Annet`; groups without items do not appear.
- The header shows the ISO week of `weekStart` and `x av n kjøpt`, updating as items are checked.
- Editing a name or quantity sends only the changed fields; an empty name is rejected inline; the item keeps its checked state and category.
- Every action is possible with 44 px targets at 360 px width; Playwright walk at 360 px and 1280 px with screenshots under `docs/reviews/screenshots/T32/`.

Tests: server test that items carry the product's category and `null` for a manual item; client tests for grouping order and the `Annet` fallback, the header progress, inline edit with changed-fields-only, empty-name rejection, cancel; the `SHOPPING_CATEGORY_ORDER` permutation test.
```

## Gate

Pull request, send the number and head SHA; merge after the go-ahead is recorded in `docs/reviews/T32-review.md`.
