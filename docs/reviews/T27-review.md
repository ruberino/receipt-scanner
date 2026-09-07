# Review follow-up: T27 — Kvitteringer

Review of pull request #2, commits `d362a57`, `5c81d02` and `0403e30` (T27) on `task/T27-llm-provider`, 2026-09-07.
Verdict: approved for merge, no follow-up items.

## What was verified

All five scripts exit 0 in a clean worktree at `0403e30`, 496 tests, Vitest at two workers; CI run 34109028651 is green on both jobs.
ADR-0015 records the decision, the `grok-4.6` choice with its source and date, and Ruben's call that price is not a factor; I confirmed on docs.x.ai that `grok-4.6` is the current general model.
`OpenAiCompatibleClient` replaces `KimiClient`, file, class and test; the request body carries `thinking` only for `kimi`, `maxRetries` comes from config, and `createLlmClient` is the one factory for `app.ts` and `eval/run.ts`, with `activeModel` feeding the new `model` field in `GET /api/health`.
Config: `LLM_PROVIDER` defaults to `kimi`; each provider's key is required only when that provider is active, through a `superRefine` whose message names the variable; `LLM_MAX_RETRIES` defaults to 0, so one unresponsive call can no longer hold the queue for three timeouts.
The eval labels results with provider and, for Kimi, the thinking mode, in the filename and the JSON, so the three-way matrix never overwrites itself; `eval/README.md` documents the matrix.
`.env.example`, `render.yaml` (`LLM_PROVIDER` as a value, `XAI_API_KEY` as `sync: false`), the config table and the README follow.
No real provider call was made on the branch; none was needed.

## Noted, no action

- `KIMI_TIMEOUT_MS` now times out both providers, as documented; a later rename to `LLM_TIMEOUT_MS` would read better but is not worth a config break now.

## Go-ahead, 2026-09-07

Approved: commit this file on the branch, push, wait for green, merge with `gh pr merge --rebase --delete-branch`, `git pull --ff-only`.
After the merge the foreman switches the demo instance to `LLM_PROVIDER=grok` for a first live look; the decision between providers waits for the eval matrix after T28.
T28 is next, then T29.
