# Review: the subtractive design pass — Kvitteringer

Review of pull request #24, commits `e15355f` through `850af23` on `task/design-subtractive-pass`, 2026-09-18.
Verdict at first pass: one required item (F1), one line of colour in two files; the tokens, the component classes and the two ordering changes hold up, nothing section 10 names was lost, and the screenshots match the code.

## What was verified

Tokens: `styles.css` declares the two faces itself and pulls only the latin `woff2` from each package, one type ratio with three sizes, the cream ground, blue ink in three strengths, blush and the brick red, exactly as ADR-0020 states.
The ADR's own test — Tailwind's default palette and size utilities are out of the client — holds empirically: a grep over `src/client` for `text-(xs|sm|base|lg|…)` and for any `(text|bg|border|ring|decoration)-<default colour>-<number>` returns nothing.
Component classes `.btn`, `.field`, `.eyebrow`, `.meta`, `.chip`, `.link`, `.option`, `.popover`, `.note`, `.disclosure` are each used where the ADR says, and `.disclosure` keeps the summary a `list-item` so the marker survives — the screenshots show it open and closed.
Content: every user-facing string on `main` is still in the client on the branch (extracted and compared both ways). The one that looked lost — `Knytt en kvittering til listen fra kvitteringssiden.` on the list detail page — is only wrapped across lines inside the merged paragraph.
`Skjult`, the warning chips, the status badge labels, the kind chips and the `n varianter` line all remain; they render as text or as one blush block instead of pills, which is how the ADR says a badge should look now.
Receipts order: `desc(coalesce(purchased_at, substr(created_at,1,10)))`, `desc(id)`, with the client moved from a cursor on id to `offset`. Cursor-on-id would have been wrong the moment the order stopped following the id, so the swap is right, the architecture entry is rewritten to match, and the new test proves an unscanned receipt sorts by its upload day while three scanned ones sort by their purchase date.
Products order: `byNewestFirst` puts a never-bought product last and breaks ties on the name in `nb`; the parent-before-child pass runs after it and is unchanged. The new test proves a one-off bought last week outranks a staple bought twice a month ago.
Screenshots: `after-30-kvitteringer.png` shows the receipts list in date order on the household's own rows (11. sep, 5. sep, 4. sep, 4. sep, 31. aug …), `after-51-statistikk.png` shows the month labels on one line with the bar track in `ink-faint`, `after-50-kvittering-varsel.png` shows the single blush block.
All five scripts exit 0 in a clean worktree at `850af23` (Node 24.21.0): lint, typecheck, 814 tests in 54 files, build (two woff2 at 27.35 kB and 32.29 kB, CSS 17.53 kB), and `format:check`, which CI also runs. CI is green on the pull request.

## Required before merge

- F1. The PWA chrome is a different cream from the page.
  `src/client/index.html` sets `theme-color` and `src/client/public/manifest.webmanifest` sets both `theme_color` and `background_color` to `#FFF8EF`, while the ground the page actually paints is `--color-paper: #f1ede1`.
  ADR-0020 says "the theme colour in `index.html` and the manifest follows the cream ground" and the pull request repeats it, so this is the one colour in the branch that comes from neither the tokens nor the ADR.
  On a phone with the app installed, the status bar band and the splash sit a shade lighter than the screen below them — the seam is on the first screen of a pass whose subject is that there is one ground.
  Fix: `#F1EDE1` in all three places.
  Nothing to test beyond the build; the value is the token's.

## Noted, no action

- The receipts list now pages by offset while it polls. If a receipt is uploaded between two page loads, a row can repeat across pages (and repeat a React key) or be skipped. The list pages at 50 and the household is nowhere near a second page, so the cursor is not worth rebuilding; worth remembering if the page size ever drops.
- The shopping list row hides an item's `reason` once it is checked. That reads right — a checked item has moved to `Kjøpt (n)` and its reason has done its work — and section 10 does not name the line, so it stays as it is.
- The receipt page widens to `md:max-w-5xl` while `.page` is `max-w-2xl` everywhere else. It is the one screen with the image beside the lines, so the exception is earned; the ADR sentence about one outer margin reads as if there were none.
- ADR-0020 says no CDN reaches "the content security policy". The app sends no CSP at all, so the sentence describes a header that does not exist. The fonts are genuinely same-origin either way.
- Two stray blank lines inside JSX attribute lists (`ProposalPanel.tsx:106`, `SuggestionCard.tsx:9`). Prettier keeps them, so `format:check` is green; they are noise in an otherwise tidy diff.

## Follow-up, not this branch

- `Ligner på kvittering #null, er den skannet to ganger?` — visible in `after-50-kvittering-varsel.png` on the household's own data.
  `possible_duplicate_of` is `ON DELETE SET NULL`, so deleting the duplicate leaves `POSSIBLE_DUPLICATE` in `warnings_json` pointing at nothing, and `WARNING_LABELS` interpolates the null.
  The label code is identical on `main`, so this branch did not cause it — but it did move the text from a small yellow pill into the blush block, where it is now the loudest thing on the receipt.
  A task should either drop the warning when the id goes null, or word the label without an id when there is none.
