# ADR-0002: Single TypeScript package with React + Vite frontend and Fastify backend

- Status: Accepted
- Date: 2026-09-05

## Context

The household already runs `sissel` and `shopper` on React + Vite + Node + SQLite, each split into two packages.
The sibling `training-log` app, designed at the same time as this one, chose a single-package variant of that stack.
Using the same layout for both new apps means one set of conventions to learn and copy.
This app adds file uploads, image processing and an outbound LLM API call, all of which Fastify handles well.

## Decision

- One npm package at the repository root with `src/client`, `src/server` and `src/shared`, the same layout as `training-log`.
- Frontend: React 19, Vite 7, React Router 7, TanStack Query 5, Tailwind CSS 4.
- Backend: Fastify 5 with `@fastify/cookie`, `@fastify/static`, `@fastify/rate-limit` and `@fastify/multipart`.
- Image processing with `sharp`.
- LLM access through the `openai` npm SDK pointed at the Moonshot base URL (ADR-0003); it is the only module allowed to import that package.
- TypeScript strict everywhere, `tsx` runs the server in development and production (so it is a regular dependency that survives `npm ci --omit=dev`), `npm` without workspaces, ESLint 9 flat config, Prettier.
- One process serves the SPA from `dist/client` and the API from `/api` on the same origin.

## Consequences

- One `package.json`, one lockfile, one CI pipeline, one Docker build.
- Shared zod schemas and types without a publishing step.
- `sharp` is a native dependency; the Docker final stage must run `npm ci` on the target platform.
- `tsx` in production adds a small startup cost; accepted for parity with `sissel` and `training-log`.

## Alternatives considered

- Two packages in a workspace like `sissel`: more configuration for no benefit at this size.
- Next.js full-stack: server/client component and caching rules are a frequent source of mistakes for smaller models, and long-running background jobs fit less naturally.
- Extending the `shopper` app instead of a new app: `shopper` is a price-and-recipe tool with a different data model; the user asked for a standalone app.
