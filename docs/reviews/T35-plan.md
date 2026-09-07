# T35 plan — Kvitteringer: the receipt image beside the extracted lines

Foreman's task definition, 2026-09-07, on Ruben's request: "legg ved bildet av kvitteringen så man kan sammenligne enkelt med det som er analysert på kvitteringen".
Order: after T30 merges, before T33; Ruben is reviewing receipts right now and this is what he needs for it.
Branch `task/T35-receipt-image-compare`, pull request per AGENTS.md, docs commit first.

## The problem

The `done` view of `/receipts/:id` shows the header, the lines and the actions, and never the image; the image only appears while the receipt is `uploaded`, `pending`, `processing` or `failed`.
Checking what the model read against what the receipt says means leaving the page.

## The change

- Phone (below `md`): a `Vis bilde` / `Skjul bilde` button (44 px) directly under the warning chips.
  When shown, the image sits in a panel that is `sticky top-0`, `45vh` tall, `overflow-auto`, with the image at the panel's full width so the digits are readable and the panel scrolls vertically inside itself; the lines scroll underneath, so the image stays on screen while the user goes through the lines.
  The choice is remembered for the session in `sessionStorage` (`receipt-image-panel`), default hidden, wrapped in try/catch like every storage access.
- Desktop (`md` and up): two columns, the image in a left column of half the width, `sticky` with `max-h-[calc(100vh-4rem)] overflow-auto`, the header, lines and actions in the right column; no toggle.
- The image is wrapped in a link to `imageUrl` with `target="_blank"` and `rel="noreferrer"`, so a tap opens the full image in a new tab for pinch-zoom; `alt="Kvitteringsbilde"`.
- The `uploaded`, `pending`/`processing` and `failed` views keep their thumbnail as it is.
- `GET /api/receipts/:id/image` is unchanged; it already sends `Cache-Control: private, max-age=86400`, so the panel costs one request per receipt per day.

## Docs commit

- `docs/architecture.md`, section 10, `/receipts/:id` row, the `done` part gains "the receipt image in a sticky, scrollable panel: toggled with `Vis bilde` on a phone, always beside the lines on desktop, tap opens the full image".
- `docs/tasks.md`, append:

```
## T35 — The receipt image beside the extracted lines

Goal: the user compares the lines with the receipt itself without leaving the page.

Files: `src/client/pages/ReceiptPage.tsx`, tests.

Steps: see `docs/reviews/T35-plan.md`.

Acceptance criteria:

- On a `done` receipt at 360 px, `Vis bilde` shows the image in a sticky 45vh panel that scrolls on its own while the lines scroll beneath; `Skjul bilde` hides it; the choice survives navigating to another receipt in the same session.
- At 1280 px the image is beside the lines with no toggle, and stays in view while the lines scroll.
- The image links to the full-size image in a new tab.
- Playwright walk with screenshots at 360 px (hidden, shown, scrolled) and 1280 px under `docs/reviews/screenshots/T35/`.

Tests: client tests for the toggle, the stored preference, the link; layout is covered by the screenshots.
```

## Gate

Pull request, send the number and head SHA; merge after the go-ahead is recorded in `docs/reviews/T35-review.md`.
