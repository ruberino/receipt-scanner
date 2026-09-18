# T46 plan — Kvitteringer: the checks run in Docker

Foreman's task definition, 2026-09-18, from Ruben's standing rule the same day: everything is built and run through Docker.
Branch `task/T46-docker-checks`, which **already exists on the remote** and carries two foreman commits — the T45 review recovered after the merge race, and environment notes E6 and E7. Base your docs commit on it rather than on `main`, and do not rebase those two away.

## Why

Today both sessions run `lint`, `typecheck`, `test`, `build` and `format:check` on the host, through a `PATH` prepended with `%APPDATA%\nvm\v24.21.0` because `node` is not on this machine's `PATH` at all (E3). Three things follow from that, and all three have already happened today:

- A run that never started looks like a run that failed — exit 127 from a missing `node`, exit 1 from a vitest path that matches nothing (E6).
- Two sessions verifying the same commit on two host toolchains can disagree, and neither is the deployment.
- The thing we ship is the image; the thing we test is somebody's laptop.

## Decisions

- **One way to run the checks, used by both sessions and by CI.** If CI runs something the sessions cannot run identically, the drift is back on the day the lockfile changes.
- **`npm ci` is cached and the checks are not.** The Dockerfile's `build` stage already installs from `package.json` and `package-lock.json` before the source is copied, so the install layer survives a source change. The checks stage must re-run every time regardless — a cached "tests passed" from an earlier source tree is the worst possible output of this task. `--no-cache-filter` on the checks stage is the mechanism I expect; argue for another if it is better, but the property is not negotiable.
- **A re-run with an unchanged lockfile is seconds, not minutes.** If it is minutes, the caching is wrong and the rule will quietly stop being followed.
- **One test file can be run alone.** The mutation check both sessions now run on every task — revert the file under test, run its test file, read `Tests n failed | m passed` — has to work through the same path, so the entry point takes an optional vitest argument.
- **The exit code is the real one**, per script, and the output is readable without digging in a build log. A green wall that hides which of the five failed is not an improvement on today.
- **`AGENTS.md` changes with it**: done means the five checks passed in the container, and the pull request pastes that output. E3 stays in `environment.md` as the host fallback and as the reason this exists, demoted rather than deleted.

## Not in this task

- The app's own Dockerfile stages that produce the runtime image. Add to them; do not reorganise them.
- Anything about how the demo is deployed or rebuilt.
- The eval harness. It talks to a paid API and stays a deliberate, manual act (ADR-0016, AGENTS.md).
- Making the checks faster than they are. Cache the install, not the work.

## Files

`Dockerfile`, `docker-compose.checks.yml` or an equivalent entry point, `.github/workflows/*.yml`, `AGENTS.md`, `docs/reviews/environment.md` (E3 demoted to the fallback), `docs/architecture.md` if section 3 or the tooling section describes how the checks are run, `docs/tasks.md`.

## Acceptance criteria

- One documented command runs all five checks in a container built from the repository, and its exit code is non-zero when any of them fails.
- The same command with a vitest path runs that file alone, so the mutation check works through it.
- With the lockfile unchanged and a warm cache, a second run does not reinstall dependencies; state the measured wall-clock time for the second run in the pull request.
- Changing a source file and re-running re-runs the checks — no cached pass. Prove it: make a test fail, run, see it fail, revert, run, see it pass, and say so in the pull request.
- CI runs the checks through the same path as a session does.
- `AGENTS.md` says done means the container run, and `README.md` or the same place says how to run it.
- The checks pass in the container at the branch head, and that output is the one pasted into the pull request.

## Tests

No unit tests; this is toolchain. The evidence is the pull request: the command, its output, the warm-cache timing, and the deliberate-failure demonstration above.

## A note on what this is worth

This task removes a class of mistake rather than a bug. Both of today's environment notes, E3 and E6, are about a check that did not run being read as a check that ran — and the answer to both is that the checks should run somewhere that cannot be misconfigured by accident. Ruben's rule got there first; this is the repository catching up with it.
