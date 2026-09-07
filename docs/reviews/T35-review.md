# Review: T35 — Kvitteringer

Review of pull request #8, commits `dfedea5` (docs) and `aabac77` (implementation) on `task/T35-receipt-image-compare`, 2026-09-07.
Verdict at first pass: one small required item (F1); the layout itself is right on both widths.

## What was verified

Desktop: a `md:` two-column layout, the image in a sticky left column with its own scroll, header, lines and actions on the right; the four screenshots show the panel pinned while the lines scroll on the phone and the two columns at 1280 px.
Phone: `Vis bilde` / `Skjul bilde` under the header, a `sticky top-0 z-10 h-[45vh] overflow-auto` panel, preference in `sessionStorage` behind try/catch, default hidden; the image is a link to the full file in a new tab with `rel="noreferrer"` and `alt="Kvitteringsbilde"`.
Tests cover the link, the toggle and the remembered preference across a remount.
Architecture section 10 row and the tasks.md entry follow the plan; the plan file is unchanged.
CI run on `aabac77` is green on both jobs.

## Required before merge

- F1. On the phone, once the panel is pinned and the user has scrolled into the lines, `Skjul bilde` has scrolled away with the header, so hiding the image means scrolling back to the top.
  Keep the control reachable while the panel is shown: put `Skjul bilde` inside the sticky block (a small 44 px button overlaid top-right on the panel is enough), so the sticky area is the panel plus its own close control; `Vis bilde` stays where it is when the panel is hidden.
  Extend the toggle test so the hide control is found while the panel is shown; retake the two "shown" and "scrolled" screenshots.

## Noted, no action

- The desktop column's `<img>` is `hidden` below `md`, and browsers still fetch a hidden image, so a phone downloads the receipt image once per done receipt even with the panel hidden; the image route's one-day `Cache-Control` keeps it to one fetch, and the toggle then shows it from cache.
  Not worth a `matchMedia` hook.
