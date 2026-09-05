# ADR-0010: SQLite with Drizzle ORM and migrations applied at startup

- Status: Accepted
- Date: 2026-09-05

## Context

Data volume is one household: a few thousand receipt lines and a few hundred products a year, plus images of 20–30 MB a year (ADR-0005).
The existing apps use SQLite with Prisma or raw `better-sqlite3`; Prisma needed engine binaries and baselining logic in `sissel`.
Typed queries matter here because the domain has several joins (lines to products to receipts) and window-style aggregations.

## Decision

- SQLite through `better-sqlite3` with `journal_mode = WAL` and `foreign_keys = ON`.
- Drizzle ORM for typed queries; `drizzle-kit generate` produces SQL migrations committed under `drizzle/`.
- Migrations are applied by the application at startup before listening, through the Drizzle migrator.
- Tests use `:memory:` databases with the same migrations.
- Multi-row writes that must be consistent (receipt plus image, extraction results, matching results, merge) run inside `sqlite.transaction()`.
- Aggregations for product statistics and purchase histories use Drizzle `sql` fragments where the query builder is insufficient; raw SQL strings outside migrations are otherwise not allowed.

## Consequences

- No engine binaries, simple Docker build, one command to start.
- A failed migration stops the process before it serves traffic.
- Litestream (ADR-0011) works unchanged with WAL mode.
- One writer at a time; the job runner (ADR-0006) and API writes are short transactions, so contention is not a concern.

## Alternatives considered

- Prisma: heavier build and runtime; migration baselining was an operational nuisance in `sissel`.
- Raw `better-sqlite3`: no types for a schema with seven tables and several joins.
- Postgres: another paid service for a tiny dataset.
