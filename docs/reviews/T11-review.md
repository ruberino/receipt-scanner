# Review follow-up: T11 — Kvitteringer

Review of commit `8009df2` (T11) on `task/T11-products-api`, 2026-09-06.
Verdict: approved for fast-forward merge after F1 and F2.

## What was verified

All five scripts exit 0 on the branch; 257 tests pass.
`computeProductStats` counts distinct purchase dates, takes the median of the gaps between consecutive dates and returns `null` below two; `loadProductStats`, `loadProductStatsMap` and `loadProductHistories` read only `item` lines on `done` receipts, and the hand-computed three-receipt fixture matches.
`GET /api/products` filters with `LIKE` on `name_normalized` against `normalizeText(q)`, which also neutralises `%` and `_` in the query, and sorts by `timesBought` descending then Norwegian name order.
`GET /api/products/:id` returns aliases and purchases newest first in the section 9 shape.
`POST` and `PATCH` enforce uniqueness on `name_normalized` with `409`; `mergeProducts` runs in one transaction, moves lines and aliases, adds the source name as an alias when free, deletes the source, and answers `400` on equal ids and `404` on a missing side; `DELETE /api/product-aliases/:id` leaves lines untouched.
Every endpoint has a 401 test; 46 new tests cover every acceptance bullet.
The three judgment calls stand: purchases per line because the shape carries `receiptId`; `includeSuppressed` defaulting to exclude; `category` not nullable because `Annet` is the null category.

Answer to the open question: the `PATCH` pre-check is enough, and not for the reason given.
`better-sqlite3` is synchronous and the handler has no `await` between the select and the update, so nothing can interleave inside one process; the same holds for `POST`, whose catch is therefore redundant but harmless.
Leave both as they are.

## F1 — Required before merge: `includeSuppressed=false` includes suppressed products

`z.coerce.boolean()` is `Boolean(input)`, and `Boolean('false')` is `true`.
`?includeSuppressed=false` therefore behaves like `true`; the existing test only covers the default and `true`.

Steps: replace it with `z.enum(['true', 'false']).optional()` and compare to `'true'`, as the sibling does for `includeArchived`; add a test that `includeSuppressed=false` excludes suppressed products and that `includeSuppressed=maybe` returns 400.

## F2 — Required before merge: the list uses one statistics query, not one per product

`GET /api/products` calls `loadProductStats(app.db, row.id)` for every row although `loadProductStatsMap` exists for exactly this.

Steps:

1. Call `loadProductStatsMap` once in the list handler and look each product up in it, defaulting to zeros.
2. Add the `dbVerbose` option the sibling has (`openDatabase(path, { verbose })`, threaded through `buildApp` and `createTestApp`) and a test that listing ten products with purchases runs at most two SQL statements after login.

Acceptance: the statement-count test passes and the fixture test still matches.

## Done

F1 and F2 as one `fix:` commit on the T11 branch, then fast-forward merge and send the hash.
