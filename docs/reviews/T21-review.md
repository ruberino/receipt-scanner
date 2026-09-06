# Review follow-up: T21 — Kvitteringer

Review of commits `5deacd8`, `b48fd37` and `d0f711f` (T21) on `task/T21-deploy-render-litestream`, 2026-09-07.
Verdict: approved for fast-forward merge after the one-word F1.

## What was verified

All five scripts exit 0 in a clean worktree at `d0f711f`, 435 tests, Vitest at two workers.
The image builds from the worktree; inside it `litestream version` prints v0.3.13, `require('sharp')` loads, `/data` is owned by `node` and the process runs as uid 1000.
The Dockerfile is the sibling's T13 design with the `sharp` check added: three stages on `node:22-alpine`, npm 12 in both Node stages, the Litestream binary from `litestream/litestream:0.3.13`, `npm ci --omit=dev`, the resolve check before any copy, `USER node`, no `HEALTHCHECK`.
`start.sh` and `litestream.yml` are the sibling's text; `docker-compose.yml` is one service on 8080 with a named volume and `env_file`; `docker-compose.drill.yml` runs MinIO, a bucket-creating `mc` step and the app with drill credentials; `render.yaml` is web, docker, free, Frankfurt, health check on `/api/health`, seven `sync: false` secrets.
`.dockerignore` excludes `node_modules`, `dist`, `data`, `.env`, the screenshots, `test` and `eval/receipts`; the last one is right, a build context is independent of `.gitignore`.
`GET /api/health` reports `replication: 'on' | 'off'` from an optional `LITESTREAM_BUCKET` that treats the empty string from an env file as unset; three tests, docs row, ADR-0011 line and `.env.example` all updated in the docs commit first.
The drill in `docs/reviews/T21-drill.md` follows the agreed sequence with no Kimi call: two uploaded receipts, one product, one list with one item; volume deleted; restore ran before the app listened; both images back with identical sha256; health reports replication on.
The README has the deploy section, the drill and the Render step; the release checklist is the task's list plus the replication line.
The agent moved its local compose ports off 8080 during the runs because Ruben's Treningslogg demo holds that port, and reverted before committing; the committed files say 8080.

## F1 — Required before merge: the drill record's date

`T21-drill.md` says `2026-09-06 (host local time)`, but the container logs in the same file are stamped `22:31Z`, which is 00:31 on 2026-09-07 in Oslo; the host date was the 7th.
Change the date line; nothing else.

## Recommendations, no action now

- The image is 663 MB; `npm cache clean --force` after each `npm ci` in the Dockerfile and `--no-audit --no-fund` shave the layers, and the runtime stage does not need the build stage's dev dependencies, which is already the case.
  Measure before and after when T22's Docker build check exists.
- Render deploys from a Git host, so publishing this repository on GitHub, as the sibling is, comes before the Render service; that decision and the secrets scan of the history are the foreman's and Ruben's, not part of this task.

## Pending for Ruben

Publish the repository, create the Render service from `render.yaml`, enter the seven secrets, and confirm `/api/health` returns `replication: 'on'`; record the result here.

## Done

F1 in a `docs:` commit, then fast-forward merge and send the hash; T22 (CI) is next and can be built locally against the sibling's workflow, to run once the repository has a remote.

## Go-ahead, 2026-09-07

F1 landed as `421514b`, a one-line docs change on the branch verified at `d0f711f`.
The history and the tracked files were scanned for keys, passwords, tunnel addresses and receipt photos before publication: clean; only the `.env.example` placeholder and test IPs match.
Approved for fast-forward merge; T22 next, built locally, no push until Ruben decides on the remote.
