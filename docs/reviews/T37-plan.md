# T37 plan — Kvitteringer: an AI proposal for the week's shopping list

Foreman's task definition, 2026-09-07, from Ruben's request: an AI-recommended weekly list based on the receipts, aware of the season and the calendar (July, Christmas, Halloween and the like), with a recent scope ("vi trenger ikke bleier selv om vi handlet det ofte for 2 år siden") and variation in dinner items so the household does not eat the same dinner every week.
Ruben's decisions, asked and answered the same day: variation in dinner items but no named weekly menu; a separate `Foreslå med AI` button whose proposal the user reviews item by item, with the rule engine staying as the baseline; no household notes field; public holidays, Oslo school holidays, Halloween, advent and fellesferie, and date-based seasonal goods all count.
Order: after T34 merges (the list UI from T31, T32 and T34 is what this builds on).
Branch `task/T37-ai-proposal`, pull request per AGENTS.md, docs commit first; this task is large enough that the docs commit must be pushed and read by the foreman before the implementation starts.

## The change in one paragraph

An open list gets a `Foreslå med AI` button.
One LLM call receives the household's purchase history for the last 26 weeks, today's date, the calendar events of the next three weeks, what is already on the list and what was dismissed from it, and returns 5 to 15 additions, each with a Norwegian reason and a kind (`sesong`, `merkedag`, `variasjon`, `vane`).
The user sees the proposal with every item pre-checked, unchecks what they do not want, and adds the rest; the proposal and the accepted subset are stored, so the acceptance rate is the quality metric for the prompt.
The rule engine (ADR-0008) is untouched and still fills a new list; the AI proposal is an explicit, paid, user-triggered addition.

## ADR-0016 — LLM proposal beside the rule engine

Write `docs/adr/0016-llm-shopping-list-proposal.md` with:

- Context: the rule engine only knows repetition; season, holidays, recency and variation need judgement, and Ruben has decided the app may pay a few øre for it per tap.
- Decision: keep the rule engine as the baseline; add a third `LlmPurpose`, `propose`, called only when the user taps `Foreslå med AI`, never automatically; the same `LlmClient` and provider as extraction and matching; the model's answer is a proposal the user accepts item by item, never applied blindly; every proposal and its accepted subset are stored.
- Consequences: one text-only call of roughly 6–10k prompt tokens per tap (a few US cents on any provider); non-deterministic output, so tests use `FakeLlmClient` and the content is measured in production by acceptance rate (`accepted items / proposed items` over `shopping_list_proposals`), which replaces the eval-harness rule for this one prompt (AGENTS.md gets that sentence); purchase history as text goes to the provider, which the receipts already do as images (architecture section 5).
- Alternatives rejected: the AI replacing the rule engine (no baseline, every list costs a call, nothing to compare against); a weekly menu (Ruben chose variation without named dinners).

## Data

- Migration 1: `shopping_list_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE, model TEXT NOT NULL, prompt_version INTEGER NOT NULL, items_json TEXT NOT NULL, raw_response TEXT NOT NULL, prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL, duration_ms INTEGER NOT NULL, accepted_json TEXT, created_at TEXT NOT NULL)`; index on `list_id`.
- Migration 2: `shopping_list_items.source` CHECK gains `'ai'`.
  This is a table recreate in SQLite; the runner turns foreign keys off around `migrate()` and runs `PRAGMA foreign_key_check` (T24), and the migration test must show that existing lists, items and dismissals survive with their ids.
- Migration 3 (review F2): `shopping_list_items` gains a nullable `category` column, a plain `ALTER TABLE … ADD COLUMN`; an existing item survives with `category` null.
  `loadItems`/`loadItemCategory` (`src/server/routes/shoppingLists.ts`) return `COALESCE(products.category, shopping_list_items.category)`, so a matched product's own category still wins and this is only the fallback for a productless item.
- Items accepted from a proposal are inserted with `source = 'ai'`, the model's `reason`, `quantityText`, `category` (review F2 — set on every inserted item, harmless when a product is also set), `productId` when the proposal named an existing product, `position` after the current maximum.

## Calendar (`src/shared/calendar.ts`, pure)

`calendarEvents(today: string, horizonDays = 21): CalendarEvent[]` with `{ date, endDate?, name }`, sorted, covering `today` to `today + horizonDays`:

- Public holidays: nyttårsdag, skjærtorsdag, langfredag, 1. og 2. påskedag, 1. mai, 17. mai, Kristi himmelfartsdag, 1. og 2. pinsedag, 1. og 2. juledag; Easter by the Anonymous Gregorian algorithm; also julaften and nyttårsaften as observances.
- Oslo school holidays: vinterferie ISO week 8, høstferie ISO week 40, juleferie 21 December to 1 January, sommerferie from the Saturday of ISO week 25 to the Sunday of ISO week 33 (approximate, say so in the doc comment).
- Halloween 31 October; the four advent Sundays; fellesferie ISO weeks 28 to 30.
- Tests with fixed dates: Easter 2026 is 5 April, 2027 is 28 March; Halloween in range on 2026-10-15 and out of range on 2026-09-07; høstferie 2026 is week 40, 28 September to 4 October.

Season (grilling, Norwegian strawberries, fårikål, lutefisk, pinnekjøtt and the like) is left to the model's knowledge from the date; the prompt says so.

## Context builder (`src/server/domain/proposalContext.ts`, pure given its inputs)

`buildProposalContext({ histories, list, dismissedProductIds, previousProposals, today })` returns the object serialised into the user message:

- `today`, the weekday in Norwegian, the ISO week, and `calendarEvents(today)`.
- `products`: every non-suppressed product with at least one purchase in the last 26 weeks (the recent scope; anything older is not sent at all), as `{ id, name, category, purchases: [ "2026-09-04 x1", … ] }` with dates descending, at most the last 12 purchases; flags `onList` (any item on the list with that `productId`), `dismissed` (T34 dismissals for this list), `rejected` (proposed by an earlier proposal on this list and not accepted).
- `listItems`: the names on the list now, checked or not, so manual items without a product are visible too.
- A size guard: if the serialised context exceeds 40 000 characters, drop purchases older than 12 weeks first, then cap products at 250 by most recent purchase; log one `warn` line with the counts.

## Prompt (`src/server/llm/prompts/proposeList.prompt.ts`, `PROPOSE_PROMPT_VERSION = 1`)

System prompt, in English like the others, stating:

- The task: propose 5 to 15 additions to the household's list for one weekly shopping trip that must cover the coming seven days (Ruben's frame, T36), from their purchase history and the calendar; quantities are what the household uses in a week; never repeat something that is `onList`, `dismissed` or `rejected`; never propose something bought today or yesterday.
- Weighting: the last 8 weeks matter most; the history only contains the last 26 weeks, and nothing older exists for a reason.
- Variation: look at the dinner-bearing purchases of the last 2 weeks (meat, fish, ready meals, the carbohydrates that go with them) and propose different dinner items that the household has bought before in the window or that are natural alternatives, so the same dinner is not repeated week after week.
- Season and calendar: use the date and the listed events to propose seasonal goods and what the household will need for a holiday, a school break or a celebration that falls inside the horizon; do not propose for events outside it.
- Output: exactly one JSON object `{ "items": [ { "productId": number | null, "name": string, "category": one of PRODUCT_CATEGORIES, "quantityText": string | null, "reason": string, "kind": "sesong" | "merkedag" | "variasjon" | "vane" } ] }`; `name` is the known product's exact name when `productId` is set, else a new name following the matching prompt's naming guidance; `reason` in Norwegian, at most 120 characters, concrete ("Halloween 31. oktober", "Ikke kjøpt fisk på to uker, sist var kjøttdeig og pølser").
- One worked example with three items of different kinds.

`src/server/llm/proposeList.ts`: `runProposal(llm, context)` builds the request (`purpose: 'propose'`, `maxTokens: 4000`), parses with a zod schema, drops items whose `productId` is not in the context or whose category is unknown (with a `warn` log naming how many were dropped, never their text), de-duplicates by normalised name, filters out anything `onList`, `dismissed`, `rejected` or bought today or yesterday (the engine's step 3 rule, T36) as a defence against the model ignoring the rule, and returns at most 15 items.
`OpenAiCompatibleClient.stageFor` maps `propose` to a new stage `proposal`; errors surface as an `AppError` subclass with `userMessage` `Kunne ikke lage forslag, prøv igjen`.

## API

- `POST /api/shopping-lists/:id/proposals`: `201 ShoppingListProposal` `{ id, createdAt, model, items: [ { index, productId, name, category, quantityText, reason, kind } ] }`.
  Only when the list is `open`, else `409` with `Listen er ikke åpen`; `404` when missing.
  Builds the context, calls the LLM, stores the row (items after filtering, raw response, tokens, duration), logs one `info` line with usage as every LLM call does.
  Synchronous, like `rematch`; the client shows a timer.
- `POST /api/shopping-lists/:id/proposals/:proposalId/accept` with `{ indexes: number[] }`: `200 ShoppingList`.
  Inserts the chosen items as `source = 'ai'`, records `accepted_json` (the indexes, possibly empty), skips an index whose product is meanwhile on the list; `409` when the proposal already has `accepted_json` or the list is not open; `404` when the proposal does not belong to the list.
- `GET /api/stats/summary` gains `aiProposals: { proposals, proposedItems, acceptedItems }` so the acceptance rate is visible in the statistics section without a database query.

## Client

- `Foreslå med AI` (44 px, secondary) next to `Oppdater forslag` at the bottom of the open list; disabled while pending; while pending the button reads `Tenker… (x s)` with the same elapsed-seconds pattern as the processing view, since a call may take 20–60 s.
- The proposal renders as a panel above the buttons: heading `Forslag fra AI`, one row per item with a checkbox (pre-checked), the name, the quantity, the reason in grey and a small kind chip (`Sesong`, `Merkedag`, `Variasjon`, `Vane`); `Legg til valgte (n)` (n updates as boxes change) and `Avbryt` (records an accept with no indexes so the items count as rejected next time).
  Success toast `n varer lagt til`; the new items appear in their category groups (T32).
- Errors go through `apiErrorMessage` to the toast; a timeout is the same message.
- Hooks `useCreateProposal(listId)` and `useAcceptProposal(listId)` in `queries.ts`; accept sets the current-list cache from the response and invalidates `['shopping-lists']` and `['stats']`.

## Docs commit (own commit, pushed before implementation)

- ADR-0016 as above.
- `docs/architecture.md`: section 3 LLM row ("extraction, matching and list proposals"); section 6 the new table, the `source` value and the invariant "a proposal is applied only through accept"; a new section 7.7 "Proposal call" mirroring 7.3 (request shape, `maxTokens`, no image, stage `proposal`); section 8 gains a closing paragraph pointing at ADR-0016; section 9 the two API rows, the `ShoppingListProposal` type and the `stats` field; section 10 the `/` row; the repository layout for `calendar.ts`, `proposalContext.ts`, `proposeList.ts` and the prompt file.
- `AGENTS.md`: the eval bullet gains "the list-proposal prompt has no ground truth and is measured by acceptance rate instead (ADR-0016)".
- `docs/tasks.md`, append:

```
## T37 — An AI proposal for the week's shopping list

Goal: one tap gives a reviewed set of additions that the rule engine cannot know: season, holidays, variation, and only from the recent past.

Files: `src/shared/calendar.ts`, `src/server/domain/proposalContext.ts`, `src/server/llm/proposeList.ts`, `src/server/llm/prompts/proposeList.prompt.ts`, `src/server/llm/LlmClient.ts`, `src/server/llm/OpenAiCompatibleClient.ts`, `src/server/db/schema.ts`, two migrations, `src/server/routes/shoppingLists.ts`, `src/server/routes/stats.ts`, `src/shared/schemas.ts`, `src/client/pages/ShoppingListPage.tsx`, `src/client/api/queries.ts`, `docs/adr/0016-*.md`, tests.

Steps: see `docs/reviews/T37-plan.md`.

Acceptance criteria:

- `Foreslå med AI` on an open list produces a proposal of 5 to 15 items with Norwegian reasons and kinds, none of which is on the list, dismissed, rejected earlier on this list, or bought today or yesterday (the engine's step 3 rule, T36).
- Products with no purchase in the last 26 weeks are not in the context sent to the model.
- On 2026-10-15 the calendar context contains Halloween; on 2026-09-07 it does not; Easter 2026 falls on 5 April.
- Accepting three of seven items adds exactly those three as `source = 'ai'` with their reasons, records the accepted indexes, and a second accept gives `409`.
- The statistics section shows proposals, proposed items and accepted items.
- Existing lists and items survive the `source` migration with their ids.
- 44 px targets at 360 px width; Playwright walk with screenshots (pending, proposal, after accept) under `docs/reviews/screenshots/T37/`.

Tests: calendar dates; context builder (26-week scope, flags, size guard); prompt parse fixtures (valid, unknown product dropped, duplicate collapsed, on-list filtered, invalid category dropped, `finishReason` length); routes with `FakeLlmClient` (201, 409 not open, 404, 401, accept, double accept, empty accept); stats field; migration survival; client (pending timer, pre-checked rows, uncheck, add selected, cancel, error toast).
```

## Real-data check after merge

The foreman runs one proposal on the demo list with Grok and one with Kimi; the review file records only counts, the kind distribution and durations (the repository is public and purchases are private), and the item names and reasons go to Ruben directly, so he can judge the first quality by eye before the acceptance rate exists.

## Gate

Docs commit pushed and confirmed by the foreman before implementation; pull request, send the number and head SHA; merge after the go-ahead is recorded in `docs/reviews/T37-review.md`.
