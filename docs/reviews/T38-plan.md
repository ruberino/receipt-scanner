# T38 plan — Kvitteringer: one LLM provider per purpose (Grok reads receipts, Kimi proposes)

Foreman's task definition, 2026-09-07, from Ruben's decision after the T37 real-data check: "kimi kan prøve seg på ai forslagene, mens grok skal lese kvitteringer".
The numbers behind it are in `docs/reviews/T37-review.md` (Real-data check): one proposal took 210 s on Grok and 16 s on Kimi, while the extraction eval of 2026-09-07 (`eval/results/`) shows the two providers equal on the receipt set and Ruben keeps Grok for reading.
Pull request #16 (`docs: T37 real-data check on the demo (Grok and Kimi)`, foreman-authored, documentation only, CI green) is open at the same time; Ruben merges it himself, it touches only `docs/reviews/T37-review.md`, and this task does not depend on it.
Branch `task/T38-provider-per-purpose` off the current `main`, pull request per AGENTS.md, docs commit first, then the implementation commit; the task is small enough that the foreman reviews both together.

## The change in one paragraph

`LLM_PROVIDER` keeps selecting the provider that reads receipts (extraction and matching).
A new optional `LLM_PROVIDER_PROPOSE` selects the provider for `purpose: 'propose'` and defaults to `LLM_PROVIDER`, so every existing deployment behaves exactly as before.
`createLlmClient` returns a client that routes each request by its `purpose` to the right provider's `OpenAiCompatibleClient`, sharing one instance when both purposes use the same provider.
`GET /api/health` reports both models.
Nothing above the `LlmClient` interface changes: `extractReceipt.ts`, `matchProducts.ts`, `proposeList.ts`, the receipt processor, the routes, the client and `eval/run.ts` are untouched apart from what the health route needs.

## ADR-0017 — one provider per purpose

Write `docs/adr/0017-llm-provider-per-purpose.md`:

- Context: ADR-0015 made the provider selectable for the whole app; ADR-0016 said the proposal uses "the same `LlmClient` and provider as extraction and matching".
  The real-data check showed that latency matters differently per purpose (a person waits in the shop for a proposal; nobody waits for a queued receipt) and that the quality bar differs (eval set for extraction, acceptance rate for the proposal), so the best provider need not be the same.
- Decision: the provider is chosen per `LlmPurpose`.
  One env var per purpose that may differ from the default: `LLM_PROVIDER_PROPOSE` today; `match` stays with extraction because it runs in the same pipeline on the same receipt.
  Routing lives inside `createLlmClient`, below the `LlmClient` interface, so no caller knows.
  The model per call keeps being recorded where it already is (`receipts.model`, `shopping_list_proposals.model`), so there is no schema change.
  The deployment carries Ruben's choice: `render.yaml` sets `LLM_PROVIDER=grok` and `LLM_PROVIDER_PROPOSE=kimi`.
  The code defaults stay `kimi` for both, so a fresh install with one key still works.
- Status notes: add "Superseded in part by ADR-0017" under the status line of ADR-0015 (the single-provider assumption) and ADR-0016 (the "same provider" sentence); do not rewrite those ADRs.
- Consequences: both API keys are required at start-up when the two purposes use different providers; a proposal's model can differ from the receipts' model and the health endpoint shows both; the eval harness measures extraction only and keeps using `LLM_PROVIDER`, so `LLM_PROVIDER_PROPOSE` has no effect on `npm run eval:extraction`.
- Alternatives rejected: a per-tap or per-user provider choice in the UI (an operator setting, not a user one); two decorations `app.llm` and `app.proposalLlm` (leaks the routing above the interface into every route and the processor, when `JsonCompletionRequest.purpose` already exists for exactly this kind of decision); hard-coding Kimi for `propose` (a deploy-time choice belongs in the environment, per ADR-0015's instant-rollback consequence).

## Config (`src/server/config.ts`)

- `LLM_PROVIDER_PROPOSE: z.enum(LLM_PROVIDERS).optional()`, resolved in `loadConfig` to `llmProviderPropose: LlmProvider` as `LLM_PROVIDER_PROPOSE ?? LLM_PROVIDER`; the field on `Config` is never undefined.
- `superRefine` checks keys over the set of providers in use (`LLM_PROVIDER` and the resolved propose provider): `MOONSHOT_API_KEY` is required when `kimi` is in the set, `XAI_API_KEY` when `grok` is; the message names the variable that selected the provider, for example `MOONSHOT_API_KEY is required when LLM_PROVIDER_PROPOSE=kimi`.
- Tests (`test/server/config.test.ts`): the default equals `LLM_PROVIDER`; `LLM_PROVIDER=grok` with `LLM_PROVIDER_PROPOSE=kimi` and only `XAI_API_KEY` fails with a message naming `MOONSHOT_API_KEY` and `LLM_PROVIDER_PROPOSE`; with both keys it passes and `llmProviderPropose` is `kimi`; an invalid value fails.

## Client factory (`src/server/llm/OpenAiCompatibleClient.ts`, new `src/server/llm/PurposeRoutingLlmClient.ts`)

- `PurposeRoutingLlmClient implements LlmClient` takes `{ fallback: LlmClient; byPurpose: Partial<Record<LlmPurpose, LlmClient>> }`; `completeJson(request)` forwards to `byPurpose[request.purpose] ?? fallback`; `clientFor(purpose)` is public so tests can read `provider` and `model` off the chosen `OpenAiCompatibleClient`.
- `createLlmClient(config, logger)` keeps its signature and return type.
  Internally the two existing branches become `buildProviderClient(provider, config, logger)` with the same options as today (Grok without `thinking`, Kimi with `config.kimiThinking`, both with `kimiTimeoutMs` and `llmMaxRetries`), one instance per provider in use kept in a `Map<LlmProvider, OpenAiCompatibleClient>`, and the factory always returns a `PurposeRoutingLlmClient` with `fallback` for `config.llmProvider` and `byPurpose.propose` for `config.llmProviderPropose`, one code path whether or not the providers differ.
- `activeModel(config)` becomes `activeModels(config): { model: string; proposalModel: string }`: `model` is the extraction provider's model (the name is kept so `GET /api/health` stays compatible), `proposalModel` the propose provider's.
- Tests: routing by purpose with two `FakeLlmClient`s (`extract` and `match` reach the fallback, `propose` reaches the other); `createLlmClient` with `grok`/`kimi` gives `clientFor('extract')` on `grok` with `xaiModel` and `clientFor('propose')` on `kimi` with `kimiModel`; with equal providers `clientFor('extract') === clientFor('propose')` (one SDK client, one connection pool); `activeModels` for both combinations.
  The existing `createLlmClient` tests in `test/server/llm/OpenAiCompatibleClient.test.ts` are adapted to read through `clientFor`, not deleted.

## Health (`src/server/routes/health.ts`, `src/server/app.ts`)

- `HealthRouteOptions` gains `proposalModel: string` and the response gains `proposalModel`; `model` stays and means extraction and matching.
- `app.ts` spreads `activeModels(config)` into the health options.
- Test (`test/server/health.test.ts`): both fields present; with differing providers they differ.

## Deployment and docs

- `render.yaml`: `LLM_PROVIDER` value `grok`; new entry `LLM_PROVIDER_PROPOSE` value `kimi`; the two key entries already exist with `sync: false`, and Ruben enters the keys himself.
- `.env.example`: `LLM_PROVIDER_PROPOSE=` with a comment (provider for the AI list proposal, `kimi` or `grok`, defaults to `LLM_PROVIDER`, ADR-0017), and the two key comments now read "Required when kimi/grok is selected by `LLM_PROVIDER` or `LLM_PROVIDER_PROPOSE`".
- `docs/architecture.md`: the section 5 layout line for the new file; 7.3 opens with "Request to the extraction provider (`LLM_PROVIDER`)"; 7.7 opens with "Request to the proposal provider (`LLM_PROVIDER_PROPOSE`, default `LLM_PROVIDER`)" and its `model` bullet follows; the section 9 health row gains `proposalModel`; the section 11 configuration table gains the `LLM_PROVIDER_PROPOSE` row and the two key rows say which variables can require them.
- `eval/README.md`: one sentence that the harness measures extraction and uses `LLM_PROVIDER` only, and that `loadConfig()` still demands both keys when the `.env` names two providers.
- `docs/tasks.md`: the T38 entry in the same shape as T37's (goal, files, steps pointing here, acceptance criteria, tests).
- AGENTS.md: unchanged; no prompt, default model, thinking mode or schema changes, so no eval run is required for this PR.

## Acceptance criteria

- With `LLM_PROVIDER=grok`, `LLM_PROVIDER_PROPOSE=kimi` and both keys, a scan goes to the Grok model and `Foreslå med AI` to the Kimi model with `thinking` from `KIMI_THINKING`; `shopping_list_proposals.model` records the Kimi model while `receipts.model` records the Grok model.
- With `LLM_PROVIDER_PROPOSE` unset, every purpose uses `LLM_PROVIDER` and the app needs only that provider's key, exactly as before.
- Start-up fails with a message naming the missing key and the variable that selected the provider when the two purposes differ and one key is absent.
- `GET /api/health` returns `model` and `proposalModel`.
- `git diff --stat` shows no change under `src/client/`, in `extractReceipt.ts`, `matchProducts.ts`, `proposeList.ts`, the receipt processor or `eval/run.ts`.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass; the PR description pastes the summary.

## After the merge (foreman)

The demo's `.env` gets `LLM_PROVIDER_PROPOSE=kimi` beside `LLM_PROVIDER=grok`, restarted once the scan queue is empty.
Health must show `grok-4.6` and `kimi-k2.6`; one proposal on a temporary list confirms the Kimi model in the stored proposal and the log line, then the list is deleted.
`docs/reviews/T38-review.md` records the check with counts and durations only; item names go to Ruben directly (public repository, architecture section 11).
