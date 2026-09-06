# Environment notes

Facts about this machine and the toolchain that tasks depend on.
Verified by the reviewing agent on 2026-09-06 in a clean checkout of the sibling app `training-log`; the machine runs Windows 11, Node 24.14.0 and npm 11.9.0.
Both apps pin the same `better-sqlite3`, `fastify` and `vitest` versions, so the findings apply here as well.

## E1 — `npm ci` with npm 11 fails on `better-sqlite3` 13.0.3; the fix is npm 12

- `better-sqlite3` 13 ships prebuilt binaries inside the package under `prebuilds/<platform>-<arch>.node` and has no install script; `lib/binding.js` falls back to them when `build/Release` is missing.
- npm 11.9 still runs `node-gyp rebuild` for the package on `npm ci`, ignoring its `gypfile: false`, and the build fails on a machine without Python and MSVC with `gyp ERR! find Python`.
- npm 12.0.2 skips install scripts by default, prints `npm warn install-scripts better-sqlite3@13.0.3 (install: node-gyp rebuild)`, and `npm ci` exits 0; the module then loads from the bundled prebuild.
- `node:22-alpine`, the production base image, carries npm 10 and no compiler, so the Dockerfile must install npm 12 in every stage that runs `npm ci`.

Steps, in the next follow-up round:

1. Add `"npm": ">=12"` next to `"node"` in `engines`.
2. In `README.md`, under "Run locally", state: "Requires Node.js 22 or later and npm 12 or later (`npm install -g npm@12`)."
3. The Dockerfile in T21 runs `npm install -g npm@12` before `npm ci` in every stage; the CI workflow in T22 does the same.

Acceptance: `rm -rf node_modules && npm ci` exits 0 with npm 12, and `node -e "new (require('better-sqlite3'))(':memory:')"` prints nothing.

## E2 — The first Fastify test on a cold module cache exceeds Vitest's 5 s default timeout

Reproduced in `training-log` on a fresh `node_modules`: the first `app.inject()` test timed out at 5 s, the second run took 160 ms, identical with the `forks` and `threads` pools.
The pool is not the cause; Vitest 3 already defaults to `forks`.
Mitigation: `testTimeout: 15000` in `vitest.config.ts`, with the comment "First Fastify boot on a cold module cache can exceed 5 s on Windows."
