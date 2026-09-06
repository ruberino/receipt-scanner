# Kvitteringer

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

## Dependency notes

Versions are pinned exactly at the newest stable release; see `docs/architecture.md` section 3 for the policy and its exceptions (peer conflicts, a different Node major, config-only-passable checks, pre-releases).
`typescript` stays on 5.9.3 because `typescript-eslint` 8.69.0's peer range is `>=4.8.4 <6.1.0`; `vite` stays on 7.x because `@vitejs/plugin-react` 6.x requires Vite's Rolldown-based toolchain (`oxc-transform-react`, `@rolldown/plugin-babel`, `babel-plugin-react-compiler`), not a config-only upgrade.
Extraction uses JSON mode with the app's own zod schemas (ADR-0003), never the SDK's `openai/helpers/zod`; ESLint rejects that import regardless of the SDK version.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system design, domain model, API contract.
- [`docs/adr/`](docs/adr/) — architecture decision records; read before changing anything they cover.
- [`docs/tasks.md`](docs/tasks.md) — the ordered task list this app is built from.
- [`AGENTS.md`](AGENTS.md) — conventions every task follows.
