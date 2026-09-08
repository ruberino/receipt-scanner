# Review: T40 — Kvitteringer

Review of pull request #22, commits `a34ca3f` (docs) and `041ebb4` (implementation) on `task/T40-product-groups`, 2026-09-08.
Verdict at first pass: two required items (F1, F2), both small; the model, the fold, the routes and the client follow the plan and the tests are thorough.
Second pass on `878c2dd`: F1 and F2 are done; approved, see the go-ahead at the end.

## What was verified

Data: migration `0007` is a plain `ADD COLUMN ... REFERENCES products(id) ON DELETE SET NULL` plus the index, the clause present in the SQL this time; the migration test shows an existing product surviving with `null` and a parent's deletion (through merge) leaving its children ungrouped.
Fold: `foldHistories` sums children into the parent per date, builds a row for a parent without purchases of its own from the `parents` rows, leaves a suppressed child out, keeps a suppressed parent suppressed, sets `variants` sorted `nb`, and leaves ungrouped rows untouched; `loadProductHistories` folds and `loadProductHistoriesUnfolded` does not; the weekly quantity of a group is the median of weekly sums across variants, proven through `computeSuggestions`; ten fold and candidate tests, two loader tests.
Candidates: `findGroupCandidates` considers unsuppressed products with neither parent nor children, keys on category and the first two normalised tokens of names with at least three tokens, needs two members, caps at 10; four tests.
Trip: `parentOf` in the input; a variant line satisfies a planned group, a sibling does not satisfy a planned variant and shows as unplanned, an empty map behaves as before; three tests plus the existing ones unchanged.
Proposal: `variants` in the context, omitted when empty; prompt version 2 with the variant rule; the parser maps a variant name to the parent and filters it like the parent; three tests.
Routes: attach with `400`/`404`/two `409`s, detach with `204`/`404`, group creation with duplicate-name `409` and the depth checks, candidates, detail with `parent`/`variants`/`groupStats`, children sorted after their parent, merge interactions; every new endpoint has its `401`; nineteen tests.
Client: the `Varegruppe` section in its three states, `GroupPicker` with attach, the naming dialog and the solo create, the merge confirm sentence; the products page candidates block with `Grupper` and `Ikke nå`, indentation by set membership (the sibling bug the Playwright walk caught, with its regression test); query hooks invalidate `['products']`.
The deviation from the plan (a page-local `GroupPicker` instead of reusing `ProductPicker`, which is bound to receipt-line matching) is the right call; generalising `ProductPicker` for one more caller would have widened a component that works.
Screenshots: variant page, parent page, candidates block and a grouped list row are consistent with the code.
All five scripts exit 0 in a clean worktree at `041ebb4`, 806 tests, Vitest at two workers; CI is green on both jobs.

## Required before merge

- F1. The parser rewrites a variant name to its parent only when the model sent `productId: null`.
  `runProposal` (`src/server/llm/proposeList.ts`) looks the name up in `childNameToParentId` inside `if (productId === null)`, while its doc comment promises the rewrite "whatever `productId` came with it", and the prompt tells the model to name the product, not the variant.
  A model that answers with the parent's id and a variant's name (the likely shape, since the parent is the only id it was given) passes through with the variant's name, so the list gets `Skyr mini banan` from a proposal that should have said `Skyr mini`, and the name-based de-duplication against the list misses the group.
  Fix: apply the variant-name lookup to every item; when the name matches a variant, set `productId` to that parent and `name` to the parent's name regardless of what came in; then the existing filters run.
  Tests: `{ productId: parentId, name: variantName }` comes back with the parent's name; `{ productId: null, name: variantName }` still maps; a parent named directly is unchanged.
- F2. A group row in the products list says `Kjøpt 0 ganger`.
  `03-group-candidates.png` shows `Skyr mini` with `Kjøpt 0 ganger` above two variants with four purchases each, because `GET /api/products` reports a parent's own stats, and `topProducts` in the statistics does the same, so a group ranks below its own variants and the top-10 counts a habit twice once the parent has lines of its own.
  Fix: for a parent, `Product.timesBought`, `lastBought` and `medianIntervalDays` are the group's folded stats (the same numbers `groupStats` already carries on the detail), in `GET /api/products` and in `topProducts`; children keep their own; `topProducts` leaves children out so a habit is counted once; the products page row for a parent shows `n varianter` under the name.
  Docs: the `Product` shape note in architecture section 9 and the section 6 sentence about a product's own stats say that a parent's summary stats are the group's; `ProductDetail.purchases` stays the parent's own lines.
  Tests: the list returns folded stats for a parent and own stats for a child; `topProducts` contains the parent once with the folded count and neither child; the products page renders `2 varianter`.

## Noted, no action

- Same-day purchases of two variants take the unit of the last one folded; the plan said the most recent, which on one date is the same information.
- `GroupPicker` searches through `useProducts({ q })` and filters out products with a parent client-side; a parent with children is offered for a direct attach, an ungrouped product opens the naming dialog. Right, and the tests cover both.
- Dismissed candidates live in `localStorage` per browser, as the plan asked; a dismissed candidate returns on another device, which is acceptable for a hint.

## Go-ahead, 2026-09-08

F1 and F2 verified at `878c2dd`: the variant-name lookup runs for every item and a `{ productId: parentId, name: variantName }` answer comes back with the parent's name (tested both ways); `loadProductStatsMap` takes the parent map and gives a parent the group's folded stats, `GET /api/products` and `topProducts` pass it, `topProducts` leaves variants out, the products page shows `n varianter`, and the retaken screenshot ranks the group above its variants with the folded count.
The list route now filters in JS over one unfiltered read so a parent's `variantCount` no longer depends on which children the search text happened to match; a fair fix inside the two-statement cap.
`GET /api/products/:id` keeps the parent's own lines in its top-level stats next to `groupStats`, documented in section 9; consistent enough since the page renders `groupStats`, and noted here rather than required.
All five scripts exit 0 in a clean worktree at `878c2dd`, 812 tests, Vitest at two workers; CI is green on both jobs.
Approved: re-read this file, commit it on the branch, push, wait for green, merge with `gh pr merge --rebase --delete-branch`, `git pull --ff-only`.
After the merge the foreman updates the demo once its scan queue is empty, with a database backup first, and runs the real-data check described in the plan.
The Kvitteringer queue is empty after this task.

## Real-data check, 2026-09-08

Run by the foreman on the demo at `c2c2abc` against the household database (337 products), after a backup and with an empty scan queue; migration `0007` applied at start-up with no error lines and `PRAGMA foreign_key_check` clean.
Through the API, counts only:

| Step | Result |
| --- | --- |
| `GET /api/products/group-candidates` | 10 candidates (the cap), the two largest with 4 members each, one with 3, seven with 2; the yoghurt group the task started from is among the two largest, so the heuristic proposed it unaided |
| `GET /api/suggestions` before grouping | 38 suggestions, two of them variants of that yoghurt with 2 and 1 in quantity |
| `POST /api/product-groups` with the candidate's four members | `201`, `variantCount` 4, `groupStats` 4 purchases with a median gap of 8 days, variants with 2, 1, 2 and 1 purchases |
| `GET /api/suggestions` after grouping | 37 suggestions; the two variant rows are gone and one row for the group stands in their place with quantity 2 and the reason "Kjøpes ca. hver 7. dag" |
| `GET /api/products/group-candidates` after | 10 (the next candidate moved up into the cap) |

Judgement: the fold does what the plan promised on real rows: one habit, one row, the weekly quantity from the summed variants.
One observation for the household rather than the code: the candidate heuristic groups by name prefix, so a multi-pack variant landed in the same group as the single cups; the quantity `2 stk` then means two of whichever the household picks, and the product page's `Fjern fra gruppen` is the way to split it if that matters.
The group created here stays in the demo database as the first real varegruppe; product names went to Ruben directly (architecture section 11).
