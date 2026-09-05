# ADR-0012: Structured logging with pino and one error format

- Status: Accepted
- Date: 2026-09-05

## Context

Errors must be triage-ready: found via logs, with a stack and enough ids to act on.
This app has a background job and an external API, so failures happen outside any request and must still be attributable to a receipt.
Smaller models tend to use `console.log`, swallow errors, or log entire prompts and images unless the rules are explicit.

## Decision

- Fastify is created with the pino logger, `level` from config and `redact` for `req.headers.cookie` and `req.headers.authorization`.
- `request.log` inside handlers; `app.log.child({ module })` in the job runner, the LLM client and domain services.
- `console.*` is forbidden in `src/` and enforced by ESLint `no-console: error`.
- Errors are real `Error` objects.
  `src/server/lib/errors.ts` defines `AppError` with `statusCode` and `code`, plus `NotFoundError`, `ConflictError`, `UnauthorizedError`, `PayloadTooLargeError`, and the job-level `ExtractionError` with a user-facing Norwegian message.
- One `setErrorHandler` maps errors to `{ error: { code, message, details?, requestId } }`; zod errors become `400 VALIDATION_ERROR`; unknown errors become `500 INTERNAL` with a generic message and a full `error` log line.
- Every LLM call logs one `info` line with `purpose`, `receiptId`, `model`, `promptVersion`, `promptTokens`, `completionTokens`, `durationMs`, `finishReason`.
  Images, prompts and responses are never logged at `info`; the raw response is stored on the receipt for debugging.
- Job failures log at `error` with `err`, `receiptId`, `attempts`, `stage` (`extraction` or `matching`).
- Never log secrets: password, cookie values, `SESSION_SECRET`, `MOONSHOT_API_KEY`.

## Consequences

- A failed receipt in the UI always has a matching error log line with its id and stage.
- Token usage per call is visible in logs, so cost can be checked without a dashboard.
- One error shape for the client.

## Alternatives considered

- `console.log`: unstructured, no redaction.
- Logging full prompts and responses: useful for debugging but noisy and leaks receipt contents into log storage; storing the raw response in the database is more targeted.
