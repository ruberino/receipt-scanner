# Kvitteringer

Licensed under the MIT License, see LICENSE.

A household grocery receipt tracker.
See `docs/architecture.md` for the full design and `docs/adr/` for the decisions behind it.
`docs/tasks.md` holds the ordered implementation tasks.

## Run locally

Requires Node.js 22 or later and npm 12 or later (`npm install -g npm@12`; on a Node older than 22.22.2 or 24.15 run `npx npm@12 ci` instead, or update Node).
`better-sqlite3` ships prebuilt binaries and needs no compiler, but only npm 12+ skips the package's `node-gyp rebuild` attempt by default; on npm <12 a clean `npm ci`/`npm install` fails on a machine without Python, even though the module would have worked from the prebuild.

```
npm install
cp .env.example .env   # fill in APP_PASSWORD, SESSION_SECRET, MOONSHOT_API_KEY
npm run dev
```

This starts the Vite dev server (client) and the Fastify server (API) together; the client proxies `/api` to the server.
`npm install` also installs a git hook that refuses commits made directly on `main`.

## Scripts

| Command                   | What it does                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run dev`             | Client and server in watch mode.                                                              |
| `npm run build`           | Production client bundle to `dist/client`.                                                    |
| `npm start`               | Runs the server with `tsx` (production entry point).                                          |
| `npm run lint`            | ESLint over the whole project.                                                                |
| `npm run typecheck`       | `tsc --noEmit` for the client and server tsconfigs.                                           |
| `npm test`                | Vitest unit and API tests (no network, no cost).                                              |
| `npm run format`          | Prettier over the project (`format:check` only reports); `docs/` is excluded on purpose.      |
| `npm run db:generate`     | Generates a Drizzle migration under `drizzle/` from `src/server/db/schema.ts`.                |
| `npm run eval:extraction` | Runs real receipts through Kimi and scores extraction quality (costs money, never run in CI). |

## Deploy

`Dockerfile` builds the production image: a multi-stage build compiles the client, copies the Litestream binary from `litestream/litestream:0.3.13`, and runs on `node:22-alpine`.
See `docs/architecture.md` section 13 and ADR-0011 for the full design.

Run the production image locally:

```bash
cp .env.example .env
# edit .env and set APP_PASSWORD, SESSION_SECRET, MOONSHOT_API_KEY, and (optionally) the LITESTREAM_* variables
docker compose up --build
```

The app is reachable at `http://localhost:8080`, and `/api/health` returns 200.
Without `LITESTREAM_BUCKET` set, the container starts and logs a warning that data is lost on restart; with it set, `start.sh` restores from the replica on boot and replicates continuously.

### Restore drill

Repeat this after any change to `start.sh` or `litestream.yml` (ADR-0011).
It runs against a local MinIO started from `docker-compose.drill.yml`, never against the real bucket.

```bash
docker compose -f docker-compose.drill.yml up --build -d
# log in, upload a couple of receipts, create a product, create a shopping list and add an item
docker compose -f docker-compose.drill.yml down
docker volume rm receipt-scanner_app-data
docker compose -f docker-compose.drill.yml up -d
# check http://localhost:8080/api/health and that the receipts, product and list are back
docker compose -f docker-compose.drill.yml down -v
```

See `docs/reviews/T21-drill.md` for the last recorded run.

### Render

`render.yaml` declares one `web` service, `runtime: docker`, `plan: free`, `healthCheckPath: /api/health`.
Creating the service and setting `APP_PASSWORD`, `SESSION_SECRET`, `MOONSHOT_API_KEY` and the four `LITESTREAM_*` secrets is a manual step in the Render dashboard; the blueprint marks them `sync: false` for exactly that reason.

## Dependency notes

Versions are pinned exactly at the newest stable release; see `docs/architecture.md` section 3 for the policy and its exceptions (peer conflicts, a different Node major, config-only-passable checks, pre-releases).
`typescript` stays on 5.9.3 because `typescript-eslint` 8.69.0's peer range is `>=4.8.4 <6.1.0`; `vite` stays on 7.x because `@vitejs/plugin-react` 6.x requires Vite's Rolldown-based toolchain (`oxc-transform-react`, `@rolldown/plugin-babel`, `babel-plugin-react-compiler`), not a config-only upgrade.
Extraction uses JSON mode with the app's own zod schemas (ADR-0003), never the SDK's `openai/helpers/zod`; ESLint rejects that import regardless of the SDK version.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system design, domain model, API contract.
- [`docs/adr/`](docs/adr/) — architecture decision records; read before changing anything they cover.
- [`docs/tasks.md`](docs/tasks.md) — the ordered task list this app is built from.
- [`AGENTS.md`](AGENTS.md) — conventions every task follows.
