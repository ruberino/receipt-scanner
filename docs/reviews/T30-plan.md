# T30 plan — Kvitteringer: the receipt page's failed and processing states

Foreman's task definition, 2026-09-07, after two things Ruben hit in the demo: he could not delete a failed receipt ("får ikke slettet den"), and the timer on the processing view restarts from 0 every time he leaves and reopens the page ("timer på scanning resettes hver gang jeg går inn og ut av siden").
One intent: the two non-`done` states of `/receipts/:id` tell the truth and offer a way out.
Branch `task/T30-delete-failed-receipt`, pull request per AGENTS.md; docs commit first, small enough to be one commit after it.

## Second item: the processing timer

`ProcessingView` counts seconds in local state from mount, so navigating away and back restarts it, and the number never meant anything beyond "how long this component has been on screen".
Change: `ReceiptSummary` (and so `ReceiptDetail`) gains `updatedAt: z.string()`, which the server already keeps at every status change (`scan` sets it with `pending`, the processor with `processing`, `done` and `failed`).
`ProcessingView` takes `status` and `updatedAt` and shows the time since that timestamp, ticking once a second from `Date.now() − Date.parse(updatedAt)`, never below 0; the label is `I kø… (x s)` while `pending` and `Leser kvittering… (x s)` while `processing`, so the restart at the `pending → processing` transition is the honest one: the wait in the queue and the time in the model are shown separately.
Tests: the view renders the elapsed time from `updatedAt` against a faked clock, a remount shows the same elapsed time, the two labels by status; the summary schema and `toReceiptSummary` test gain the field.
Docs: architecture section 10, `/receipts/:id` row, "While `pending`/`processing`: image thumbnail and `I kø…`/`Leser kvittering…` with the seconds since the status changed, with polling"; the `ReceiptSummary` type in section 9 gains `updatedAt`.

## The bug

`ReceiptPage.tsx` renders a `failed` receipt with the image, the status badge, the error message and `Prøv igjen`, and nothing else.
`DELETE /api/receipts/:id` accepts any status, and both the `uploaded` view and the `done` view already have `Slett kvittering` behind `window.confirm`, so the failed view is the one state a receipt can get stuck in with no way out but the API.
A receipt whose image is unreadable (the 142×2000 px strips from before T28) fails on every retry, so this is the normal path for exactly those receipts.

## The change

- The `failed` view gets the same `Slett kvittering` button as the `uploaded` view: red outline, `min-h-11`, `window.confirm('Slette denne kvitteringen? Dette kan ikke angres.')`, `useDeleteReceipt`, toast `Kvitteringen er slettet`, navigate to `/receipts`.
  Extract the shared handler and button so the three views use one component instead of a third copy.
- `docs/architecture.md`, section 10, `/receipts/:id` row: "When `failed`: error, `Prøv igjen`, which calls scan, and `Slett kvittering`."
- `docs/tasks.md`, append:

```
## T30 — The receipt page's failed and processing states

Goal: a receipt that keeps failing can be removed where the user sees the failure, and the processing view shows how long the receipt has really been waiting or being read.

Files: `src/client/pages/ReceiptPage.tsx`, `src/shared/schemas.ts`, `src/server/routes/receipts.ts`, tests.

Acceptance criteria:

- The `failed` view shows `Slett kvittering`; confirming deletes the receipt, shows `Kvitteringen er slettet` and navigates to `/receipts`; dismissing the confirmation deletes nothing.
- The `uploaded` and `done` views behave as before; one shared delete button component, no third copy of the handler.
- `ReceiptSummary` carries `updatedAt`; the processing view shows `I kø… (x s)` while `pending` and `Leser kvittering… (x s)` while `processing`, with `x` counted from `updatedAt`, so leaving and reopening the page shows the same elapsed time.
- Screenshots of the failed view and the processing view at 360 px under `docs/reviews/screenshots/T30/`.

Tests: client tests for the failed view's delete after confirmation and after dismissal, the elapsed time from `updatedAt` against a faked clock, the same time after a remount, the two labels; the existing uploaded and done delete tests keep passing; `toReceiptSummary` includes `updatedAt`.
```

## Gate

Pull request, send the number and head SHA; merge after the go-ahead is recorded in `docs/reviews/T30-review.md`.
