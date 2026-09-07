# ADR-0017: One LLM provider per purpose

- Status: Accepted
- Date: 2026-09-07

## Context

ADR-0015 made the provider selectable for the whole app, one `LLM_PROVIDER` for every call.
ADR-0016 said the proposal call uses "the same `LlmClient` and provider as extraction and matching".
The real-data check recorded in `docs/reviews/T37-review.md` ran one proposal on Grok and one on Kimi: Grok took 210 s, Kimi 16 s, on the same demo list.
The extraction eval of 2026-09-07 (`eval/results/`) shows the two providers equal on the receipt set, and Ruben keeps Grok for reading receipts.
Latency matters differently per purpose: a person waits in the shop for a proposal, but nobody waits for a queued receipt.
The quality bar also differs: an eval set with ground truth for extraction, an acceptance rate for the proposal.
So the best provider need not be the same for both, and Ruben decided: "kimi kan prøve seg på ai forslagene, mens grok skal lese kvitteringer."

## Decision

- The provider is chosen per `LlmPurpose`, not once for the whole app.
  `LLM_PROVIDER` keeps selecting the provider for `extract` and `match` — they run in the same pipeline on the same receipt, so they always share a provider.
  A new optional `LLM_PROVIDER_PROPOSE` selects the provider for `propose` and defaults to `LLM_PROVIDER`, so an existing single-provider deployment is unaffected.
- Routing lives inside `createLlmClient` (`src/server/llm/OpenAiCompatibleClient.ts`), below the `LlmClient` interface: a new `PurposeRoutingLlmClient` forwards `completeJson` to whichever `OpenAiCompatibleClient` is registered for the request's `purpose`, or a fallback for everything else.
  No caller — `extractReceipt.ts`, `matchProducts.ts`, `proposeList.ts`, the receipt processor, the routes, the client, `eval/run.ts` — knows or needs to know that two providers might be involved.
- One `OpenAiCompatibleClient` instance per distinct provider actually in use, shared between purposes that agree, so two purposes on the same provider still share one SDK client and connection pool.
- The model per call keeps being recorded where it already is (`receipts.model`, `shopping_list_proposals.model`); no schema change.
- `GET /api/health` reports `model` (extraction and matching) and `proposalModel` (the proposal), so an operator can see both without reading logs.
- The deployment carries Ruben's choice: `render.yaml` sets `LLM_PROVIDER=grok` and `LLM_PROVIDER_PROPOSE=kimi`.
  The code defaults stay `kimi` for both, so a fresh install with one key still works exactly as before this ADR.
- Superseded in part: ADR-0015's single-provider-for-the-whole-app assumption and ADR-0016's "same provider as extraction and matching" sentence are both narrowed by this decision; neither ADR is rewritten.

## Consequences

- Both API keys are required at start-up whenever the two purposes resolve to different providers; `loadConfig`'s validation names both the missing key and the environment variable that selected the provider needing it (`LLM_PROVIDER` or `LLM_PROVIDER_PROPOSE`), so a misconfigured deploy fails with a clear message rather than a confusing runtime error on the first proposal.
- A proposal's model can differ from the receipts' model; `GET /api/health` and the stored rows already carry enough to tell them apart.
- The eval harness is unaffected: it measures extraction only, builds its client from `LLM_PROVIDER` alone (`createLlmClient` still resolves `propose` the same way for it, but `eval/run.ts` never sends a `propose` request), and `LLM_PROVIDER_PROPOSE` has no effect on `npm run eval:extraction`.
- `match` cannot be routed independently of `extract` without a second env var and a second place the two could disagree, for a purpose that never runs on its own; if that changes, it gets its own ADR.

## Alternatives considered

- A per-tap or per-user provider choice in the UI: rejected — this is an operator/deployment decision about cost and latency, not something the household chooses per shopping trip.
- Two decorations on the Fastify instance, `app.llm` and `app.proposalLlm`: rejected — it leaks the routing decision above the `LlmClient` interface into every route and the receipt processor that would need to pick the right one, when `JsonCompletionRequest.purpose` already exists for exactly this kind of decision and `PurposeRoutingLlmClient` can act on it in one place.
- Hard-coding Kimi for `propose`: rejected — a deploy-time provider choice belongs in the environment, per ADR-0015's instant-rollback consequence; hard-coding it would mean a code change and a redeploy to react to the next real-data check.
