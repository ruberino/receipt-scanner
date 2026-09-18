# Kvitteringer — agent instructions

Read `docs/architecture.md` and every file in `docs/adr/` before starting any task.
`docs/tasks.md` holds the ordered tasks with acceptance criteria.
The architecture and the ADRs are normative; a task that disagrees with them is a question, not a licence.

## Working a task

- One task per branch and pull request, branch named like `task/T09-product-matching`.
- Ask one precise question, with the options you see, when the task is ambiguous, a library or the Kimi API behaves differently than the docs describe, a decision is needed that no ADR covers, an unrelated test fails, or an acceptance criterion cannot be met.
- Stay inside the task.
  Anything else you notice goes into the PR description as a follow-up.
- Everything is built and run through Docker.
  Nothing is started on the host as a shortcut: no `npm run dev`, no `npm start`, no host-side server on 8080 or 5173 to check something quickly.
  What you hand to Ruben is the image the Dockerfile produces, which is what Render builds, so "it works here" stops being a claim about a laptop.
- Done means all five checks pass **in the container**, with that output pasted into the PR:
  `docker compose -f docker-compose.checks.yml run --build --rm checks`
  runs `lint`, `typecheck`, `test`, `build` and `format:check`, every one of them even after an earlier one fails, and exits non-zero if any did.
  Adding a path runs vitest on that file alone, which is how a single file is checked — for instance when reverting the file under test to see that its new tests can actually fail.
  Read the `Tests  n failed | m passed` line and check the failures by name; an exit code alone cannot tell a run that failed from a run that never started (`docs/reviews/environment.md` E6).
- The repository is on GitHub (`ruberino/receipt-scanner`): push the task branch, open a pull request whose description states intent, what changed, risk and how it was tested, wait for CI to be green and for the foreman's go-ahead recorded in `docs/reviews/`, then merge with `gh pr merge --rebase --delete-branch` so `main` stays linear.
- `docs/reviews/*.md` is a review channel from a foreman session Ruben also runs across his apps; check it after finishing a task and before merging, verify any checkable technical claim empirically before acting on it, and don't delete or move those files.

## Conventions that apply to every task

- UI text is Norwegian bokmål, including every `message` in an error body, because the client displays it; code, comments, commits and PRs are English.
- Amounts are integer øre and dates are `YYYY-MM-DD` strings in all server and API code; date and week arithmetic goes through `src/shared/dates.ts`.
- Log through `request.log` or `app.log` (pino).
  Throw the `AppError` subclasses from `src/server/lib/errors.ts` and let the single error handler map them.
- Every API test file has one test that its endpoint returns `401` without the cookie.
- Every LLM call goes through the `LlmClient` interface and logs one `info` line with token usage.
  Images, prompts, API keys and cookie values stay out of the logs; the raw LLM response is stored on the receipt instead.
- Tests inject `FakeLlmClient` and stay off the network.
  `eval/run.ts` is the only code that talks to Kimi, and every run costs money.
- A change to a prompt, the default model, the thinking mode or an LLM output schema ships with an `npm run eval:extraction` run in the PR, and the aggregate metrics must not regress.
  The list-proposal prompt has no ground truth and is measured by acceptance rate instead (ADR-0016).
- Dependencies are pinned to exact versions at the newest stable release, per the policy in `docs/architecture.md` section 3.
