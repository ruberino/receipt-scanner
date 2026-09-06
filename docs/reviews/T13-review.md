# Review follow-up: T13 — Kvitteringer

Review of commit `0570303` (T13) on `task/T13-shopping-lists`, 2026-09-06.
Verdict: approved for fast-forward merge after F1 and F2, both small.

## What was verified

All five scripts exit 0 on the branch; 298 tests pass.
`POST /api/shopping-lists` returns the open list with `200` or creates one in a single transaction with `weekStart = mondayOf(todayInOslo(now()))` and one `suggested` item per suggestion in score order with `reason`, `quantityText` and 1-based positions, answering `201`.
`GET /api/shopping-lists/current` answers `404` in the documented shape when nothing is open.
Manual items are appended at `max(position) + 1` with `source = 'manual'`, an unknown `productId` is a `400`, and every mutation on a `done` list is a `409` with a Norwegian message.
`PATCH /api/shopping-list-items/:id` takes a strict partial body; `DELETE` answers `204`; `POST /:id/complete` sets `done` and `completedAt` and answers `409` when already done.
The section 9 shapes are zod schemas in `shared/schemas.ts`; every endpoint has its 401 test, and the acceptance bullets (creating twice, order with a manual item last, complete then 404 then a new list) are covered.
"At most one open list" relies on the synchronous check-then-insert inside one process, which is correct for the same reason as the products `PATCH`.
A raw `position` update without renumbering siblings is fine for now; the shopping list UI in T18 decides how reordering works and can add renumbering then.
Committing the T12 review record separately was the right housekeeping.

## F1 — Required before merge: `position` is 1-based everywhere

`patchShoppingListItemSchema` allows `position: 0` while every position the server writes starts at 1.
Change `nonnegative()` to `positive()` and add a test that `position: 0` is a `400`.

## F2 — Required before merge: timestamps come from the injected clock

`weekStart` uses `options.now()`, but `createdAt` and `completedAt` use `new Date()`.
Use `options.now().toISOString()` for both, so a test that pins the clock can assert them exactly; add that assertion to the create and complete tests.

## Done

F1 and F2 as one `fix:` commit on the T13 branch, then fast-forward merge and send the hash.
