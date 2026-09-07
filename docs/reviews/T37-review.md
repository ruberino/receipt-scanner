# Review: T37 — Kvitteringer

Review of pull request #14, commits `bfce33b` and `1463ddc` (docs) and `8381ed6` (implementation) on `task/T37-ai-proposal`, 2026-09-07.
Verdict at first pass: two required items (F1, F2); the architecture of the feature is right and the tests are thorough.
Second pass on `2a39ef6`: F1 and F2 are done; approved, see the go-ahead at the end.

## What was verified

Calendar: Easter by the Anonymous Gregorian algorithm with the Easter-relative holidays derived from it, the fixed holidays, Halloween, the four Advent Sundays counted back from the Sunday on or before 24 December, Oslo school holidays by ISO week with the approximation stated in the doc comment, fellesferie weeks 28–30, a 21-day window that keeps a multi-day event already under way and spans the year boundary; nine tests with fixed dates.
Context: 26-week scope with nothing older sent, at most 12 purchases per product newest first, `onList`/`dismissed`/`rejected` flags where `rejected` counts only resolved proposals, the Norwegian weekday and ISO week, the size guard narrowing to 12 weeks and 250 products with one `warn`; fourteen tests.
Proposal call: `purpose: 'propose'`, `maxTokens` 4000, `listId` in the one usage log line, text-only body; the parser drops unknown products and categories with one counted `warn`, de-duplicates by normalised name against the answer and the list, filters `onList`, `dismissed`, `rejected` and bought today or yesterday (the T36 rule), caps at 15, and every failure mode surfaces as `ProposalFailedError` with the Norwegian message; thirteen tests.
Migrations: `0003` is a plain `CREATE TABLE shopping_list_proposals` with its index; `0004` is the drizzle table recreate for the `source` CHECK, which drops only `shopping_list_items` (no table references it) inside the runner's foreign-keys-off window; a `0002-only` fixture proves a list, an item and a dismissal survive with their ids, and the unknown-source CHECK is tested.
Routes: `POST .../proposals` builds the context, stores the filtered items, raw response, tokens and duration, returns `201`; `POST .../accept` inserts the chosen indexes as `source = 'ai'` after the maximum position, skips a product meanwhile on the list, records `accepted_json` (empty for `Avbryt`) and gives `409` on a second accept; 401, 404 (including a proposal of another list) and 409 are tested; `aiProposals` in the stats summary sums proposals, proposed and accepted items.
Client: `Foreslå med AI` with a live `Tenker… (x s)` label, a panel with every item pre-checked, reason and kind chip, `Legg til valgte (n)` live, `Avbryt` recording an empty accept, error toasts on both calls, the panel between `Legg til vare` and `Oppdater forslag`; nine tests, and a Playwright walk against a stub LLM server with five screenshots.
Docs: ADR-0016, sections 3, 6, 7.7, 8, 9, 10 and 11, the AGENTS.md sentence and the tasks.md entry, aligned to today-or-yesterday in `1463ddc`.
All five scripts exit 0 in a clean worktree at `8381ed6`, 682 tests, Vitest at two workers; CI is green on both jobs.

## Required before merge

- F1. The proposal's failure path swallows the cause.
  `runProposal` catches the client error, the `length` finish, the JSON parse failure and the schema failure and throws a bare `ProposalFailedError` every time, so the log shows a 500 with a Norwegian message and nothing about whether it was a timeout, a network refusal, a truncated answer or a shape mismatch; AGENTS.md requires triage-ready errors.
  Fix: `ProposalFailedError` takes `{ cause }` and passes it to `Error` (`super(...); this.cause = cause`, or the `ErrorOptions` form), and each of the four sites attaches what it knows: the caught error, `{ finishReason }`, the parse error, or the zod issues (paths and codes only, never the model's text); in addition, log one `warn` line with `listId`, the stage that failed and `err` before throwing, through the request logger the route already passes in.
  Tests: the four failure tests assert the `cause` and the single `warn` call.
- F2. A proposed item without a product loses the category the model gave it, so `Plommer` and `Torskefilet` land under `Annet` in the very screenshot that shows the feature working (`05-after-accept.png`); the grouping T32 built is defeated for the feature's own novel items.
  Fix: `shopping_list_items` gains a nullable `category` column through a plain `ALTER TABLE … ADD COLUMN` migration; `accept` writes the proposal item's `category` on every inserted item (with a product too, harmless and consistent); `loadItems` and `loadItemCategory` return `COALESCE(products.category, shopping_list_items.category)` so a product's category still wins; manual items keep `null`.
  Docs: the column in section 6 with "set from the AI proposal, otherwise null (T37)", the `category` sentence in the two item API rows, and the T37 plan's Data section.
  Tests: accept of a `productId: null` item with `category: 'Frukt og grønt'` comes back in the list with that category and groups under it in the client; the migration chain test covers the new column with an existing item surviving as `null`.

## Noted, no action

- `lastPurchaseDate` is serialised into the context although the prompt does not describe it; harmless, a few tokens per product.
- `ThinkingLabel` counts from mount, which here is the tap itself, so the number is honest; no `updatedAt` exists for a synchronous call.
- The real-data check from the plan (one proposal with Grok, one with Kimi on the demo) runs after the merge and the demo update.
  Correction to the plan: this repository is public and the household's purchases are private (architecture section 11), so this file records only counts, the kind distribution, durations and the foreman's judgement; the item names and reasons go to Ruben directly, not into git.

## Go-ahead, 2026-09-07

F1 and F2 verified at `2a39ef6`: every failure site attaches its cause and logs one `warn` with `listId`, the stage and `err`, with the zod issues reduced to paths and codes; migration `0005` is a plain `ADD COLUMN`, `accept` stores the proposal's category, the two read paths coalesce the product's category over the item's, the migration test shows an existing item surviving with `null`, and the retaken screenshot groups the novel items under `Frukt og grønt` and `Kjøtt og fisk`.
All five scripts exit 0 in a clean worktree at `2a39ef6`, 685 tests, Vitest at two workers; CI is green on both jobs.
Approved: re-read this file, commit it on the branch together with the plan-file correction, push, wait for green, merge with `gh pr merge --rebase --delete-branch`, `git pull --ff-only`.
After the merge the foreman updates the demo once its scan queue is empty and runs the real-data check (one proposal with Grok, one with Kimi) as described above.
The Kvitteringer queue is empty after this task.
