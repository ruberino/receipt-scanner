# Kvitteringer

A household grocery receipt tracker.
See `docs/architecture.md` for the full design and `docs/adr/` for the decisions behind it.
`docs/tasks.md` holds the ordered implementation tasks.

## Run locally

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
| `npm run eval:extraction` | Runs real receipts through Kimi and scores extraction quality (costs money, never run in CI). |

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system design, domain model, API contract.
- [`docs/adr/`](docs/adr/) — architecture decision records; read before changing anything they cover.
- [`docs/tasks.md`](docs/tasks.md) — the ordered task list this app is built from.
- [`AGENTS.md`](AGENTS.md) — conventions every task follows.
