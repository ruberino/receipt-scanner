# ADR-0013: zod schemas shared between client and server

- Status: Accepted
- Date: 2026-09-05

## Context

The API has around twenty endpoints with typed payloads, and the LLM returns JSON that must be validated before it touches the database.
Duplicating shapes across client, server and LLM parsing leads to drift.

## Decision

- API request and response shapes are zod schemas in `src/shared/schemas.ts`, strict (`.strict()`), with inferred types exported alongside.
- LLM output schemas live in `src/server/llm/` because they are server-only and include preprocess steps (decimal-comma strings to numbers) that the API schemas do not need.
- The server parses `body`, `params`, `query` and multipart fields through a small helper before handler logic; failures become `400 VALIDATION_ERROR`.
- The client uses the inferred types for payloads and hooks.
- `PRODUCT_CATEGORIES` is a shared constant and a zod enum used by both the API and the matching prompt.

## Consequences

- One definition per shape, typed end to end.
- `src/shared` stays free of Node and DOM imports.
- LLM output validation is explicit and testable with fixtures.

## Alternatives considered

- Fastify JSON Schema with a type provider: typed on the server, awkward to share with the client.
- OpenAPI code generation: heavy for this size.
