# ADR-0014: Testing strategy — fake LLM client in tests, real-receipt eval set for prompts

- Status: Accepted
- Date: 2026-09-05

## Context

Most of the app is deterministic and cheap to test, but the extraction and matching quality depends on prompts and a model we do not control.
Unit tests must never call the network or spend money.
At the same time, a prompt change that looks harmless can silently break extraction on a store layout; that needs real receipts to detect.
Never delete, skip or weaken a valid test to make a change pass, and every real-world wrong result becomes a regression case.

## Decision

- Vitest is the single runner for server and client tests.
- All LLM access goes through the `LlmClient` interface; tests inject `FakeLlmClient`, which returns scripted responses from `test/fixtures/llm/*.json` and records the requests it received.
- `KimiClient` has no unit tests beyond request construction; it is exercised only by the eval script.
- Server API tests build the app with `:memory:` and `FakeLlmClient` and call endpoints with `app.inject()`, including multipart uploads with small fixture images.
- Domain functions (`applyExtraction`, `computeSuggestions`, `normalizeText`, date helpers, merge) have unit tests with fixtures; `computeSuggestions` tests include the worked example from `architecture.md` section 8 and one test per rule.
- The extraction eval set lives in `eval/receipts/`: real receipt photos with `*.expected.json` (store, date, total, item texts and totals).
  `npm run eval:extraction` runs the real `KimiClient`, reports per-receipt and aggregate metrics (date match, store match, total within 1 kr, item recall by normalized text, price accuracy), and writes `eval/results/<date>-<promptVersion>-<model>.json`.
- Any change to a prompt, the model default, the thinking mode or the extraction schema must include an eval run in the PR, and aggregate metrics must not regress.
- Any wrong extraction or wrong match observed in real use is added to the eval set or to the fixtures before the fix is made.
- CI runs lint, typecheck, unit and API tests and the build; it never runs the eval.

## Consequences

- The full test suite runs in seconds with no network and no cost.
- Prompt quality is measured, not guessed; regressions are caught before merge.
- The eval set contains personal receipts; the repository is private and images are downscaled.
- The eval costs a few øre per receipt per run; acceptable.

## Alternatives considered

- Mocking the `openai` package directly: couples tests to the SDK shape; the interface is a cleaner seam.
- Recording real responses with a VCR-style tool: the fake with explicit fixtures is simpler and the fixtures double as documentation.
- Running the eval in CI: costs money and needs the API key in CI; a manual run per prompt change is enough at this cadence.
