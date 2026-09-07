# Review follow-up: T22 — Kvitteringer

Review of commit `b59e64c` (T22) on `task/T22-ci`, 2026-09-07.
Verdict: approved for fast-forward merge, no follow-up items; the GitHub half of the acceptance stays pending until the repository has a remote.

## What was verified

`.github/workflows/ci.yml` is the sibling's workflow with the image name changed and nothing else: `pull_request` and push to `main`, a `checks` job on Node 22 with `npm install -g npm@12` before `npm ci` and then lint, typecheck, test, build and `format:check`, and an independent `docker-build` job that builds the image without pushing.
The sibling's copy has been green on every run since its T14, which is the reference for a file that cannot run here yet.
No test needs `MOONSHOT_API_KEY`: `createTestApp` hands a fake key to `loadConfig()` and nothing under test imports `src/server/index.ts`, so the workflow needs no secrets.
The agent ran every command of the `checks` job locally in sequence (435 tests) and the exact `docker build` of the second job, and confirmed the failure path once with a deliberate unused variable that made `npm run lint` fail, reverted and not committed.

## GitHub acceptance, 2026-09-07

The remote now exists (`ruberino/receipt-scanner`), and PR #1 (`docs/pr-workflow`, switching `AGENTS.md` to the PR workflow) closes the acceptance criterion that stayed pending above.
Three runs on that PR: green on the docs-only commit `8288b86` ([run 34093673944](https://github.com/ruberino/receipt-scanner/actions/runs/34093673944)), red on a deliberate unused variable in commit `7b93f56` ([run 34093887565](https://github.com/ruberino/receipt-scanner/actions/runs/34093887565), `checks` failed on the lint error, `docker-build` passed as expected), and green again after the revert in commit `f620543` ([run 34094015129](https://github.com/ruberino/receipt-scanner/actions/runs/34094015129)).
CI gates the branch as designed.

## Go-ahead for pull request #1, 2026-09-07

The first push of `main` also ran green (run 34084508261), the workflow bullet matches the sibling's wording, the review-channel bullet now says "before merging", and the three runs above are the T22 evidence.
Approved: commit this file on the branch, push, wait for green, merge with `gh pr merge --rebase --delete-branch`, then `git pull --ff-only`.

## Done

Fast-forward merge now and send the hash.
T20 (extraction eval harness) is next: build and test it against `FakeLlmClient`; the real run against Kimi waits for Ruben's go and the expected JSON per receipt.
