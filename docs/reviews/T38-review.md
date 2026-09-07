# Review: T38 — Kvitteringer

Review of pull request #17, commits `adb6c8d` (docs) and `7d0afc0` (implementation) on `task/T38-provider-per-purpose`, 2026-09-07.
Verdict at first pass: one required item (F1); the routing, the config validation and the docs follow the plan and the tests cover them.
Second pass on `2a9c7ab`: F1 is done; approved, see the go-ahead at the end.

## What was verified

Config: `LLM_PROVIDER_PROPOSE` optional, resolved to `llmProviderPropose` with `LLM_PROVIDER` as the default and never undefined on `Config`; the key check runs over both selectors, reports each missing key once and names the selector that chose the provider; four new tests.
Routing: `PurposeRoutingLlmClient` forwards by `request.purpose` with a fallback, `clientFor` public; `createLlmClient` keeps its signature, builds one `OpenAiCompatibleClient` per distinct provider through a `Map`, always returns the routing client; `activeModels` replaces `activeModel` with `model` kept for compatibility and `proposalModel` added; four routing tests, three factory tests adapted rather than deleted, three `activeModels` tests.
Health: `proposalModel` in the options and the response; three tests including the differing-provider case.
Untouched, checked with `git diff --stat c5faa72..7d0afc0`: `src/client/`, `extractReceipt.ts`, `matchProducts.ts`, `proposeList.ts`, `jobs/receiptProcessor.ts`, `eval/run.ts`.
Docs: ADR-0017 with the status notes on ADR-0015 and ADR-0016 and the README table (including the missing 0016 row), architecture sections 3, 5, 7.3, 7.7, 9 and 11, `.env.example`, `render.yaml` with Ruben's choice, `eval/README.md`, the T38 entry in `docs/tasks.md`.
The two additions beyond the plan (section 3 stack row, section 11 privacy paragraph) are corrections of sentences the change made false; both are right.
All five scripts exit 0 in a clean worktree at `7d0afc0`, 696 tests, Vitest at two workers; CI is green on both jobs.

## Required before merge

- F1. An empty `LLM_PROVIDER_PROPOSE=` stops the server from starting.
  `.env.example` ships the line `LLM_PROVIDER_PROPOSE=`; `src/server/index.ts` loads `.env` through `dotenv/config`, which sets an empty-but-present variable to `""`, and `z.enum(LLM_PROVIDERS).optional()` rejects `""`.
  Verified at `7d0afc0` with `loadConfig({ ..., LLM_PROVIDER_PROPOSE: '' })`: `Invalid configuration: LLM_PROVIDER_PROPOSE: Invalid option: expected one of "kimi"|"grok"`, while `undefined` resolves to the default.
  Anyone who copies `.env.example` to `.env` therefore gets a failed start, and an `env_file` or a blank Render variable does the same, which is exactly the case the `LITESTREAM_BUCKET` comment in `config.ts` already describes.
  Fix: wrap the field in the same `z.preprocess((value) => (value === '' ? undefined : value), z.enum(LLM_PROVIDERS).optional())` as `LITESTREAM_BUCKET`, with a one-line comment pointing at that precedent.
  Test: `LLM_PROVIDER_PROPOSE: ''` resolves `llmProviderPropose` to `LLM_PROVIDER`, in `test/server/config.test.ts`.

## Noted, no action

- The `.env.example` comment on `KIMI_TIMEOUT_MS` still says "used by whichever provider is active"; with two providers it is used by both, which is what it does.
  Harmless wording, left alone.
- `createLlmClient` always registers `byPurpose.propose`, also when it is the same instance as the fallback; the tests assert the identity, so the sharing is guaranteed rather than incidental.

## Go-ahead, 2026-09-07

F1 verified at `2a9c7ab`: `LLM_PROVIDER_PROPOSE` goes through the same `z.preprocess` as `LITESTREAM_BUCKET`, `loadConfig({ ..., LLM_PROVIDER_PROPOSE: '' })` now resolves to `LLM_PROVIDER` (checked empirically alongside `undefined` and `'kimi'`), and the new test asserts it.
All five scripts exit 0 in a clean worktree at `2a9c7ab`, 697 tests, Vitest at two workers; CI is green on both jobs.
Approved: re-read this file, commit it on the branch, push, wait for green, merge with `gh pr merge --rebase --delete-branch`, `git pull --ff-only`.
After the merge the foreman updates the demo (`LLM_PROVIDER_PROPOSE=kimi`, restart when the queue is empty) and runs the real-data check described in the plan.
The Kvitteringer queue is empty after this task.
