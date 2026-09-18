# Environment notes

Facts about this machine and the toolchain that tasks depend on.
Verified by the reviewing agent on 2026-09-06 in a clean checkout of the sibling app `training-log`; the machine runs Windows 11, Node 24.14.0 and npm 11.9.0.
Both apps pin the same `better-sqlite3`, `fastify` and `vitest` versions, so the findings apply here as well.

## E1 — `npm ci` with npm 11 fails on `better-sqlite3` 13.0.3; the fix is npm 12

- `better-sqlite3` 13 ships prebuilt binaries inside the package under `prebuilds/<platform>-<arch>.node` and has no install script; `lib/binding.js` falls back to them when `build/Release` is missing.
- npm 11.9 still runs `node-gyp rebuild` for the package on `npm ci`, ignoring its `gypfile: false`, and the build fails on a machine without Python and MSVC with `gyp ERR! find Python`.
- npm 12.0.2 skips install scripts by default, prints `npm warn install-scripts better-sqlite3@13.0.3 (install: node-gyp rebuild)`, and `npm ci` exits 0; the module then loads from the bundled prebuild.
- `node:22-alpine`, the production base image, carries npm 10 and no compiler, so the Dockerfile must install npm 12 in every stage that runs `npm ci`.
- npm 12 declares `engines.node` as `^22.22.2 || ^24.15.0 || >=26.0.0`, so `node:22-alpine` images from 22.22.2 on take it cleanly, while this host on Node 24.14.0 can only install it globally with `--force`.
  Until the host runs Node 24.15 or newer, `npx npm@12 ci` works without a global install (verified 2026-09-06); the README states both.

Steps, in the next follow-up round:

1. Add `"npm": ">=12"` next to `"node"` in `engines`.
2. In `README.md`, under "Run locally", state: "Requires Node.js 22 or later and npm 12 or later (`npm install -g npm@12`)."
3. The Dockerfile in T21 runs `npm install -g npm@12` before `npm ci` in every stage; the CI workflow in T22 does the same.

Acceptance: `rm -rf node_modules && npm ci` exits 0 with npm 12, and `node -e "new (require('better-sqlite3'))(':memory:')"` prints nothing.

## E2 — The first Fastify test on a cold module cache exceeds Vitest's 5 s default timeout

Reproduced in `training-log` on a fresh `node_modules`: the first `app.inject()` test timed out at 5 s, the second run took 160 ms, identical with the `forks` and `threads` pools.
The pool is not the cause; Vitest 3 already defaults to `forks`.
Mitigation: `testTimeout: 15000` in `vitest.config.ts`, with the comment "First Fastify boot on a cold module cache can exceed 5 s on Windows."

## E3 — `node` is not on `PATH` in a fresh shell on this machine

Verified by the foreman on 2026-09-18 while reviewing the subtractive design pass, and hit independently by the working session the same day.

- nvm for Windows is installed with five versions under `%APPDATA%\nvm`, the newest `v24.21.0`, but the shim directory `C:\Program Files\nodejs` does not exist, so `node` and every `npm` script fail in a new shell: `npm` itself resolves and then dies with `The term 'node.exe' is not recognized`, exit 127. A run that "fails" that way has not run at all; read the exit code before believing a red result.
- `nvm use` wants elevation and hangs on the UAC prompt in a non-interactive shell, so it is not the fix here.
- The fix in a session: prepend `%APPDATA%\nvm\v24.21.0` to `PATH` once per shell (PowerShell: `$env:Path = "$env:APPDATA\nvm\v24.21.0;" + $env:Path`). Every script then behaves normally; that version carries npm 11.19.0.
- E1 still applies on top of this: npm 11 cannot run `npm ci` here because of `better-sqlite3`, so a fresh install is `npx npm@12 ci`. Running the existing `node_modules` needs nothing beyond the `PATH` line.

## E4 — Two sessions share one checkout

The foreman session and the working session both operate in `C:\Code\apps\receipt-scanner`.
A verification run is worthless if the tree moves under it, so the foreman verifies in its own `git worktree` outside the checkout and the checkout belongs to the working session.

`gh` holds three accounts in one keyring (`rubenr_aboveit`, `rubenring`, `ruberino`) and `gh auth switch` changes the active one for every session at once; only `ruberino` can push to `ruberino/receipt-scanner`, and the others get a `403`.
The repository is pinned with `git config --local credential.https://github.com.username ruberino` so a push survives the next flip.

## E5 — What resets a merge on this repository

Branch protection requires both CI jobs green **on the head commit** and the branch **current with `main`**.
Two things therefore delay a merge that looked ready, and with a foreman session and a working session merging into one repository both happen often:

- A commit pushed after CI went green — the foreman's review or go-ahead is exactly that — resets the check requirement, and the checks take about half a minute to register on the new head. A watch started immediately reports "no checks reported" rather than waiting, which is not a failure.
- Anything else landing on `main` in the meantime leaves the branch `BEHIND`. `gh pr update-branch <n> --rebase` brings it current server-side with no force-push from the working session, and then CI runs once more.

`gh pr view <n> --json mergeStateStatus` says which of the two it is in one call; read that before reading the refusal text.
Verified on 2026-09-18 while merging #25 and #26, the second of which went `BEHIND` when #16 landed between its green run and its merge.

## E6 — A vitest run against a path that matches nothing exits 1

The mutation check both sessions now run — revert the file under test, run its test file, count the failures — reads an exit code as a result, so it inherits this trap.

`npx vitest run test/server/proposalContext.test.ts` on a file that actually lives at `test/server/domain/proposalContext.test.ts` prints `No test files found, exiting with code 1` and exits 1.
A run that failed to run and a run that ran and failed look the same from the exit code alone, and the wrong one reads as "the tests fail without the fix" — the exact conclusion the check exists to establish.
Read the `Tests  n failed | m passed` line, not the exit code, and check that the failures are the tests you expected by name.
Hit by the foreman on 2026-09-18 while verifying T45; the real run was `6 failed | 14 passed` and the first "result" was nothing at all.

## E7 — A pull request's head can lag the branch ref, and the merge takes the old one silently

E5's two cases both refuse and say why. This one succeeds and looks exactly like a correct merge.

On 2026-09-18 the foreman's review commit `4154544` was pushed to `task/T45-proposal-size-guard` and GitHub's pull request object still reported `11c506a` as its head several minutes later: no check-runs for the new commit, no workflow run for it, `mergeStateStatus: UNKNOWN`.
The merge then went through against the stale head, and `docs/reviews/T45-review.md` and E6 were simply not on `main` afterwards, with the branch deleted.
Nothing was lost, because the commit was still reachable locally, but nothing warned either.

Before merging, compare what the pull request thinks it is merging with what the branch actually is:

```
gh pr view <n> --json headRefOid -q .headRefOid
git rev-parse origin/<branch>
```

Equal, or do not merge yet.
A refusal is not the only bad outcome; this is E6's lesson in another costume — the call succeeded and the success was not the one anyone wanted.
