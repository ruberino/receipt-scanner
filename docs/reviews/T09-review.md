# Review follow-up: T09 — Kvitteringer

Review of commit `c6ef4ae` (T09) on `task/T09-product-matching`, 2026-09-06.
Verdict: approved for fast-forward merge after F1 and F2.

## What was verified

All five scripts exit 0 on the branch; 189 tests pass, twice; `openai` is imported only by `KimiClient.ts`.
`matchLines` follows ADR-0004 and section 7.5: only `item` lines with `product_id IS NULL` are candidates, so discount and deposit lines never reach the LLM and a rematch is safe; alias hits link with `match_source = 'alias'` and no request; distinct unmatched texts go in one request with the known names (non-suppressed, ordered by item-line count, at most 1 000); `existingProduct` links by normalised name, `newProductName` links when its normalised form exists, otherwise a product is created with the category or `Annet`, and an `llm` alias is inserted, all in one transaction; texts missing from the response stay unmatched with `UNMATCHED_LINES`; an LLM or parse failure is logged with `receiptId` and returns `MATCHING_FAILED` without throwing.
The processor now saves the extraction while `processing`, runs `matchLines`, appends its warnings and sets `done` last, with `stage` flipped where matching starts, as the T08 notes asked.
The rematch route re-runs matching for unmatched lines, replaces only the two matching warnings and returns `ReceiptDetail`.
The prompt carries the section 7.5 naming guidance, the category list and one example; nine domain tests cover every acceptance bullet.
The two order assertions in the job-runner tests were rewritten from an exact request list to "every request for receipt A precedes every request for receipt B"; the property under test, sequential processing in id order, is intact, so this is not a weakened test.

## F1 — Required before merge: route tests for `POST /api/receipts/:id/rematch`

The message announcing this commit said the rematch endpoint had its 401 test.
It does not: the only rematch test calls `matchLines` directly, and no test touches the route.
Reports to the foreman must be accurate; a claimed test that does not exist is worse than a missing one.

Tests to add to `test/server/receiptsProcessing.test.ts`:

1. `POST /api/receipts/1/rematch` without a cookie returns 401.
2. An unknown id returns 404.
3. A receipt that ended `done` with `MATCHING_FAILED` (fake that throws for the matching call) is rematched with a fake that succeeds: the response is 200, has `lines` with `product` set and `matchSource: 'llm'`, its `warnings` no longer contain `MATCHING_FAILED`, and a non-matching warning such as `MISSING_STORE` present before is still there.

Acceptance: the three tests pass.

## F2 — Required before merge: an empty `newProductName` must not create a product

By reading `matching.ts`: `matchResultSchema` accepts `newProductName: ''`, `normalizeText('')` is `''`, no product has that normalised name the first time, so a product named `''` is created and every later empty name links to it.

Steps: in the apply loop, skip a match whose `normalizeText(newProductName)` is empty when no `existingProduct` resolved; the text then stays unmatched and counts towards `UNMATCHED_LINES`.

Test: a fake returning `{ text: 'X', existingProduct: null, newProductName: '  ', category: 'Annet' }` leaves the line unmatched, adds `UNMATCHED_LINES` and creates no product.

Acceptance: the test passes and `products` stays empty in it.

## Done

F1 and F2 as one commit on the T09 branch, then fast-forward merge and send the hash.
