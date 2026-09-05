# ADR-0004: Deterministic alias matching first, LLM matching only for unknown lines, user corrections teach aliases

- Status: Accepted
- Date: 2026-09-05

## Context

Receipts print abbreviated, store-specific texts ("TINE LETTMELK 1L", "LETTMELK TINE 1 L").
Frequency statistics and shopping suggestions only work if the same product gets the same identity across receipts and stores.
Asking an LLM to name every line on every receipt is non-deterministic: the same text can get slightly different canonical names on different days, which fragments the history.
The household buys mostly the same things, so after a few weeks most lines have been seen before.

## Decision

- A `products` table holds canonical products; a `product_aliases` table maps `normalizeText(receipt text)` to exactly one product.
- Matching runs in two steps per receipt:
  1. Every item line is looked up by its normalized text in `product_aliases`.
     A hit is final and needs no LLM.
  2. Only distinct unmatched texts are sent in one LLM call together with the list of known product names and the fixed category list.
     The LLM returns, per text, an existing product name or a new canonical name plus category.
     The server links or creates products and inserts an `llm` alias for each text.
- Product identity is `normalizeText(name)`; creating a product whose normalized name exists links to the existing product instead.
- A user correction on a line sets the product and upserts a `user` alias for that text, overriding any `llm` alias.
  Merging two products moves lines and aliases to the target and adds the source name as an alias.
- Discount, deposit and other lines are never matched.
- If the matching call fails, the receipt still completes with a `MATCHING_FAILED` warning and unmatched lines; a rematch endpoint retries only the unmatched lines.

## Consequences

- Steady state is deterministic and free: a receipt with only known texts never calls the LLM for matching.
- Every correction is permanent for that text, so the system gets better with use.
- The LLM sees the existing product list, which keeps canonical names consistent and avoids near-duplicates; merge handles the ones that slip through.
- Aliases are exact after normalisation; a new abbreviation costs one LLM decision, which is acceptable.

## Alternatives considered

- LLM names every line on every receipt: simple, but non-deterministic identities fragment the history.
- Fuzzy string matching (Levenshtein, trigram) instead of an LLM for unknown texts: cheap, but "LETTMELK" versus "LETTRØMME" style near-misses are exactly where fuzzy matching fails and an LLM does well.
- Embeddings and nearest neighbour: an extra model, an index, and tuning for a problem an exact alias table plus one LLM call solves.
- One combined extraction-and-matching call: fewer calls, but it forces the LLM to name lines that are already known and mixes two prompts into one.
