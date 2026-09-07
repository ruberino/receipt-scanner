# Architecture Decision Records

One decision per file, numbered in the order they were made.
An accepted ADR is never edited except to change its status.
To change a decision, write a new ADR that supersedes the old one and link both ways.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-single-package-react-fastify-typescript.md) | Single TypeScript package with React + Vite frontend and Fastify backend | Accepted |
| [0003](0003-receipt-extraction-with-kimi-json-mode.md) | Receipt extraction with Kimi (Moonshot AI) through the OpenAI-compatible API in JSON mode | Accepted |
| [0004](0004-deterministic-aliases-then-llm-matching.md) | Deterministic alias matching first, LLM matching only for unknown lines, user corrections teach aliases | Accepted |
| [0005](0005-receipt-images-as-blobs-in-sqlite.md) | Store normalised receipt images as BLOBs in SQLite | Accepted |
| [0006](0006-in-process-job-runner-with-persisted-status.md) | In-process job runner with persisted receipt status | Accepted |
| [0007](0007-integer-ore-civil-dates-oslo-time.md) | Money as integer øre, civil dates, Europe/Oslo as the household time zone | Accepted |
| [0008](0008-rule-based-suggestion-engine.md) | Rule-based deterministic suggestion engine, no LLM | Accepted |
| [0009](0009-shared-household-password-cookie.md) | Shared household password with a signed cookie, no user accounts | Accepted |
| [0010](0010-sqlite-drizzle-migrations-at-startup.md) | SQLite with Drizzle ORM and migrations applied at startup | Accepted |
| [0011](0011-docker-on-render-with-litestream.md) | One Docker container on Render with Litestream replication to S3 | Accepted |
| [0012](0012-structured-logging-and-error-format.md) | Structured logging with pino and one error format | Accepted |
| [0013](0013-zod-schemas-shared-between-client-and-server.md) | zod schemas shared between client and server | Accepted |
| [0014](0014-testing-strategy-with-llm-fake-and-eval-set.md) | Testing strategy: fake LLM client in tests, real-receipt eval set for prompts | Accepted |
| [0015](0015-selectable-openai-compatible-llm-provider.md) | Selectable OpenAI-compatible LLM provider (Kimi or Grok) | Accepted |

## Template

```markdown
# ADR-NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR-MMMM
- Date: YYYY-MM-DD

## Context

What situation forces a decision, and which constraints matter.

## Decision

What we decided, stated so that an implementer can act on it without asking.

## Consequences

What becomes easier, what becomes harder, what we must remember.

## Alternatives considered

Each alternative and the reason it lost.
```
