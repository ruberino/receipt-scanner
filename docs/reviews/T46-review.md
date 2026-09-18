# Review: T46 — Kvitteringer

Review of pull request #29, commits `5e48705` (docs) and `076c2f3` (implementation) on `task/T46-docker-checks`, 2026-09-18.
The branch also carries `4f93f39` and `57b896a`, foreman commits: the T45 review recovered after the merge race of E7, and environment notes E6 and E7.
Verdict: approved at first pass, no required items.

## What was verified

Run by the foreman in a separate worktree, through the command the pull request documents rather than around it:

| Run | Result |
| --- | --- |
| `docker compose -f docker-compose.checks.yml run --build --rm checks` | exit 0, 58.6 s, `lint`, `typecheck`, `test`, `build`, `format:check` all ok, 841 tests in 54 files |
| The same again, unchanged lockfile and source | exit 0, 43.8 s — the working session's 45.4 s reproduced |
| `… run --build --rm checks test/server/domain/proposalContext.test.ts` | exit 0, `Test Files 1 passed`, `Tests 20 passed` — the mutation check's path works through the same entry point |
| A deliberately failing assertion added to `test/client/format.test.ts` | exit 1, `test: FAILED (exit 1)`, and `format:check: FAILED (exit 1)` because the inserted lines were not prettier-formatted — with `lint`, `typecheck` and `build` still reported `ok`, so the run does not stop at the first failure |
| The same file reverted, run again | exit 0, all five ok, 841 tests |

That last pair is the property the task exists for, and it holds: a source change is not able to inherit a cached pass.
One honest qualification on the timings — my first run was 58.6 s rather than a true cold build, because the `npm ci` layer was already warm from the app image on this machine. The number that matters, the warm re-run, is measured twice by two sessions and agrees.
The test count in the container equals the host's, which is the assertion that the tests are in the image rather than quietly absent — the failure this task was written to make impossible.
CI now runs the same command, so the two cannot drift on the day the lockfile moves.

## The deviation from the plan, accepted

The plan named `--no-cache-filter` as the mechanism for the checks stage never being cached, and said the property was not negotiable while the means was.
The working session took that at its word and found a better means: the checks run under `docker run` through an `ENTRYPOINT`, not as a `RUN` layer, so there is no cached result to inherit in the first place.
That is stronger than the flag, because a flag is something a future caller can forget and an arrangement is not. I verified the property directly rather than the mechanism, which is why the table above ends the way it does.

## What the working session caught, which is the substance of this review

Two things would have made the tool quietly useless, and both are the exact failure this task exists to remove:

- `.dockerignore` excluded `test/`. The checks stage builds from that context, so the image would have carried no tests, `npm test` would have found no files and exited 1, and it would have read as a failing suite indefinitely — E6's trap inside the instrument built to prevent it. `test/` is now in the context, with the reason written above it, and the runtime stage still copies `src`, `drizzle` and the start files by name, so nothing extra reaches the shipped image.
- vitest's colour codes sit between the `Tests` label and its counts, so the grep E6 tells both sessions to run matched or missed depending on the run; the single-file path is where it bit. `NO_COLOR` is now set on the service, with the reason in the compose file. A guard that cannot be searched reliably is not a guard, and both sessions rely on this one.

## Noted, no action

- The working session was told to change `AGENTS.md` on the strength of the foreman relaying Ruben's rule, and asked Ruben directly before touching it, on the grounds that this is the same thing the foreman refused to take second-hand on T43. That is the rule applied symmetrically, against the person who wrote it, and it is the right instinct.
- Prettier was run through the image rather than the host, so the branch was brought into compliance by the rule it documents.

## Open, and not this task's to settle

`README.md` still documents `npm run dev` on the host under "Run locally", while `AGENTS.md` now says nothing is started on the host. For an agent the rule is unambiguous; for Ruben's own hands it is a question about the development workflow, and moving that loop into a container is real work — a bind-mounted source, a Linux `node_modules` volume, vite and tsx in watch mode.
Raised with Ruben rather than decided here. Until he says otherwise the two documents differ on purpose, which is worth knowing when reading them.

## Go-ahead, 2026-09-18

Approved at `076c2f3`: merge with `gh pr merge --rebase --delete-branch`, then `git pull --ff-only`.
Before merging, compare `gh pr view 29 --json headRefOid` with `git rev-parse origin/task/T46-docker-checks` — this commit is exactly the kind of push that E7 caught.
