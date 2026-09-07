# T27 plan — Kvitteringer: Grok (xAI) as a selectable LLM provider

Foreman's task definition, 2026-09-07, on Ruben's request: choose between Kimi and Grok.
Branch `task/T27-llm-provider`, pull request as per AGENTS.md; docs commit first.
Scope: the provider is chosen per installation through the environment; no per-receipt switch in the UI.

## The change in one paragraph

Both providers speak the OpenAI chat format with JSON mode and image input, and `KimiClient` already talks to a configurable base URL through the OpenAI SDK.
The client becomes provider-aware: one `OpenAiCompatibleClient` (renamed from `KimiClient`, the file and class) that takes `provider`, `apiKey`, `baseURL`, `model`, `timeoutMs` and, for Kimi only, `thinking`; the Moonshot-specific `thinking` field is sent only when the provider is `kimi`.
Configuration gains `LLM_PROVIDER` (`kimi` or `grok`, default `kimi`), `XAI_API_KEY`, `XAI_MODEL` and `XAI_BASE_URL` (default `https://api.x.ai/v1`); `MOONSHOT_API_KEY` is required only when the provider is `kimi`, `XAI_API_KEY` only when it is `grok`.
`GET /api/health` reports `model`, so an operator can see which model is live.

## Decisions

- Model name for Grok: do not guess.
  Read the current xAI model list at docs.x.ai, pick the newest generally available model that accepts image input and supports `response_format: json_object`, record the name, the date and the page in the ADR, and make it the `XAI_MODEL` default.
  If no model satisfies both, stop and ask.
- `receipts.model` already records which model read each receipt; no `provider` column, the model name identifies it.
- The eval harness builds its client from the same config, so `LLM_PROVIDER=grok npm run eval:extraction` writes a results file named with the Grok model, and comparing the two providers is a diff of two results files; say so in `eval/README.md`.
- Every LLM call still goes through `LlmClient`; `FakeLlmClient` and the tests do not change.
- AGENTS.md: the eval rule covers a provider or model change as it covers a prompt change; "the Kimi API behaves differently than the docs describe" becomes "the LLM API".

## Docs commit

1. New `docs/adr/0015-selectable-openai-compatible-llm-provider.md`: context (Ruben wants to compare Grok with Kimi; both are OpenAI-compatible), decision (one client, provider from env, Kimi default until the eval says otherwise), the Grok model choice with its source, consequences (a provider or model switch needs an eval run; two keys to manage on Render).
2. `docs/architecture.md`: section 3 stack row for the LLM ("Kimi K2.6 or Grok via the OpenAI SDK, ADR-0003, ADR-0015"), section 11 config table rows for the four new variables and the conditional requirement of the two keys, the health row gaining `model`, the repository layout entry for the renamed client file.
3. `.env.example`: the four variables with comments; `LLM_PROVIDER=kimi`.
4. `render.yaml`: `LLM_PROVIDER` as a plain `value: kimi` env var and `XAI_API_KEY` as `sync: false`.
5. `docs/tasks.md`, append:

```
## T27 — Grok (xAI) as a selectable LLM provider

Goal: run extraction and matching on Kimi or Grok, chosen per installation, and compare them with the eval harness.

Files: `src/server/config.ts`, `src/server/llm/OpenAiCompatibleClient.ts` (renamed from `KimiClient.ts`), `src/server/app.ts`, `eval/run.ts`, `src/server/routes/health.ts`, `.env.example`, `render.yaml`, `docs/adr/0015-*.md`, tests.

Steps:

1. Docs as in `docs/reviews/T27-plan.md`, own commit.
2. Config: `LLM_PROVIDER`, `XAI_API_KEY`, `XAI_MODEL`, `XAI_BASE_URL`; the provider's key is required, the other's optional.
3. Client: provider-aware request body (`thinking` only for Kimi), one factory used by `app.ts` and `eval/run.ts`.
4. Health reports `model`.

Acceptance criteria:

- With `LLM_PROVIDER=kimi` the request body is unchanged from today, including `thinking`.
- With `LLM_PROVIDER=grok` the request body has no `thinking` field, goes to `XAI_BASE_URL` with `XAI_MODEL`, and `GET /api/health` reports that model.
- Starting with `LLM_PROVIDER=grok` and no `XAI_API_KEY` refuses to start with a clear message; the same for `kimi` without `MOONSHOT_API_KEY`.
- The default is `kimi` and `npm test` passes without either key.

Tests: config validation for both providers, request-body building for both, health `model`, eval client factory picking the provider.
```

## After merge

The foreman switches the demo instance to `LLM_PROVIDER=grok` with Ruben's xAI key so Ruben can scan the same receipts on both providers; the eval comparison waits for the expected JSON.
The default stays `kimi` until an eval run shows Grok is not worse on `totalWithin1krRate` and `meanItemRecall`.

## Gate

Pull request with the description per AGENTS.md; send the PR number; merge after the go-ahead is recorded here.
