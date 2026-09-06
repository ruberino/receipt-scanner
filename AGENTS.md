# Kvitteringer — agent instructions

Read `docs/architecture.md` and every file in `docs/adr/` before starting any task.
`docs/tasks.md` holds the ordered tasks with acceptance criteria.
The architecture and the ADRs are normative; a task that disagrees with them is a question, not a licence.

## Working a task

- One task per branch and pull request, branch named like `task/T09-product-matching`.
- Ask one precise question, with the options you see, when the task is ambiguous, a library or the Kimi API behaves differently than the docs describe, a decision is needed that no ADR covers, an unrelated test fails, or an acceptance criterion cannot be met.
- Stay inside the task.
  Anything else you notice goes into the PR description as a follow-up.
- Done means `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass locally, with the summary pasted into the PR.
- The repository has no remote yet, so finish a task by fast-forward merging its branch into `main`; rebase onto `main` first when `main` has moved.
  Write what would have been the PR description in the body of the branch's last commit.
- `docs/reviews/*.md` is a review channel from a foreman session Ruben also runs across his apps; check it after finishing a task and before fast-forward merging, verify any checkable technical claim empirically before acting on it, and don't delete or move those files.

## Conventions that apply to every task

- UI text is Norwegian bokmål; code, comments, commits and PRs are English.
- Amounts are integer øre and dates are `YYYY-MM-DD` strings in all server and API code; date and week arithmetic goes through `src/shared/dates.ts`.
- Log through `request.log` or `app.log` (pino).
  Throw the `AppError` subclasses from `src/server/lib/errors.ts` and let the single error handler map them.
- Every LLM call goes through the `LlmClient` interface and logs one `info` line with token usage.
  Images, prompts, API keys and cookie values stay out of the logs; the raw LLM response is stored on the receipt instead.
- Tests inject `FakeLlmClient` and stay off the network.
  `eval/run.ts` is the only code that talks to Kimi, and every run costs money.
- A change to a prompt, the default model, the thinking mode or an LLM output schema ships with an `npm run eval:extraction` run in the PR, and the aggregate metrics must not regress.
- Dependencies are pinned to exact versions at the newest stable release, per the policy in `docs/architecture.md` section 3.
