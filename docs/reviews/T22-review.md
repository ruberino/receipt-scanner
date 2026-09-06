# Review follow-up: T22 — Kvitteringer

Review of commit `b59e64c` (T22) on `task/T22-ci`, 2026-09-07.
Verdict: approved for fast-forward merge, no follow-up items; the GitHub half of the acceptance stays pending until the repository has a remote.

## What was verified

`.github/workflows/ci.yml` is the sibling's workflow with the image name changed and nothing else: `pull_request` and push to `main`, a `checks` job on Node 22 with `npm install -g npm@12` before `npm ci` and then lint, typecheck, test, build and `format:check`, and an independent `docker-build` job that builds the image without pushing.
The sibling's copy has been green on every run since its T14, which is the reference for a file that cannot run here yet.
No test needs `MOONSHOT_API_KEY`: `createTestApp` hands a fake key to `loadConfig()` and nothing under test imports `src/server/index.ts`, so the workflow needs no secrets.
The agent ran every command of the `checks` job locally in sequence (435 tests) and the exact `docker build` of the second job, and confirmed the failure path once with a deliberate unused variable that made `npm run lint` fail, reverted and not committed.

## Pending until the remote exists

Green on a docs-only pull request and red on a deliberate lint error, once; record the run ids here.
The remote is Ruben's decision; see `T21-review.md`.

## Done

Fast-forward merge now and send the hash.
T20 (extraction eval harness) is next: build and test it against `FakeLlmClient`; the real run against Kimi waits for Ruben's go and the expected JSON per receipt.
