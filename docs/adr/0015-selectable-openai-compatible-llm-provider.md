# ADR-0015: Selectable OpenAI-compatible LLM provider (Kimi or Grok)

- Status: Accepted
- Date: 2026-09-07

## Context

Ruben wants to compare Grok (xAI) with Kimi (Moonshot AI, ADR-0003) on real receipts before deciding which one to keep.
Both speak the OpenAI chat-completions format: JSON mode (`response_format: { type: 'json_object' }`), image input as a base64 data URL, and the OpenAI SDK against a configurable `baseURL`.
`KimiClient` (ADR-0003) already isolates every provider detail behind the `LlmClient` interface, so nothing above that interface — the extraction pipeline, matching, the eval harness's metrics — needs to know which provider ran.
The only provider-specific detail in the client itself is Moonshot's `thinking` field, which is not part of the OpenAI SDK's types and has no xAI equivalent.

Verified facts from `docs.x.ai` on 2026-09-07:

- Base URL `https://api.x.ai/v1`, OpenAI-compatible chat completions.
- Model list at `docs.x.ai/docs/models`: the current generally-available line is `grok-4.3` → `grok-4.5` → `grok-4.6`, with `grok-4.6` listed first and described as "the most intelligent and fastest model we've built" — no beta or preview marker.
  (The `grok-4.20-*` and `grok-build-0.1` entries on the same page are date-stamped preview/specialised variants, not the general chat line, and are not considered here.)
- `grok-4.6`'s own model page (`docs.x.ai/docs/models/grok-4.6`) lists modalities `text, image → text`, `Function calling: Yes`, `Structured outputs: Yes`, and a 500,000-token context window.
- `docs.x.ai/docs/guides/image-understanding` and `docs.x.ai/docs/guides/structured-outputs` both use `grok-4.6` as the example model for image input and for `response_format: { type: 'json_object' }` respectively.
- `grok-4.6` satisfies the task's requirement (image input and `json_object` support) and is therefore the default `XAI_MODEL`.

## Decision

- `KimiClient` (file and class) is renamed to `OpenAiCompatibleClient`, parameterised by `provider: 'kimi' | 'grok'` in addition to `apiKey`, `baseURL`, `model` and `timeoutMs`; `thinking` stays a constructor option but is only sent on the request body when `provider === 'kimi'`.
- Configuration gains `LLM_PROVIDER` (`kimi` | `grok`, default `kimi`), `XAI_API_KEY`, `XAI_MODEL` (default `grok-4.6`) and `XAI_BASE_URL` (default `https://api.x.ai/v1`).
  `MOONSHOT_API_KEY` is required only when `LLM_PROVIDER=kimi`; `XAI_API_KEY` only when it is `grok`.
- One factory (`createLlmClient(config, logger)`, in `OpenAiCompatibleClient.ts`) builds the client from `Config` for whichever provider is selected; `app.ts` and `eval/run.ts` both call it instead of constructing a client themselves.
- `GET /api/health` reports `model` (the active model name) alongside the existing fields, so an operator can see which model is live without reading logs.
- `receipts.model` already records which model read each receipt (ADR-0003); no new `provider` column — the model name identifies the provider unambiguously, since `kimi-*` and `grok-*` names do not overlap.
- The eval harness builds its client from the same config and `loadConfig()`, so `LLM_PROVIDER=grok npm run eval:extraction` runs Grok and writes a results file named with the Grok model; comparing providers is a diff of two results files (`eval/README.md`).
- Kimi stays the default provider until an eval run shows Grok is not worse on `totalWithin1krRate` and `meanItemRecall` (ADR-0014).
- `FakeLlmClient` and every test that exercises the extraction/matching pipeline are unaffected: they inject `LlmClient`, never `OpenAiCompatibleClient`, and continue to run without either provider's key.

## Consequences

- Switching providers or models needs an eval run before it can become the default (ADR-0014), same as any Kimi prompt or model change.
- Two API keys to manage on Render (`MOONSHOT_API_KEY`, `XAI_API_KEY`), though only the active provider's key is required at startup.
- The client file and its test carry both providers' request-shaping logic; this is one conditional (`thinking` only for Kimi) rather than two client classes, since every other field is identical.
- A provider switch is an environment change, not a deploy of different code, so rolling back a bad model choice is instant.
- Price is not a factor in the provider or model choice: a long receipt costs a few US cents on any candidate here, negligible at one receipt a week. The decision is reading quality alone, measured by the eval harness (`eval/README.md`'s comparison matrix: `kimi-k2.6` with `KIMI_THINKING` disabled and enabled, and `grok-4.6`).

## Alternatives considered

- Two separate client classes implementing `LlmClient`: more files and near-total duplication for one conditional field; rejected in favour of one provider-aware client, matching ADR-0003's expectation that "the provider can be swapped by implementing the `LlmClient` interface" without predicting exactly how much would be shared.
- A per-receipt provider choice in the UI: out of scope — Ruben compares providers by running the same receipts through each configuration, not by picking per receipt, and it would double the surface the suggestion/matching logic has to reason about for no benefit to a household of one.
- A `provider` column on `receipts`: redundant with `model`, since model names do not collide across providers; adds a migration for no new information.
