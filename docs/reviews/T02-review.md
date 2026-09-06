# Review follow-up: T02 — Kvitteringer

Review of commit `6180b8e` (T02), now on `main`, 2026-09-06.
Verdict: approved with required follow-up.
The skeleton matches T02 and ADR-0012, already maps Fastify's own 4xx errors and captures log lines in tests.
The remaining items are a copied misdiagnosis in the Vitest config, request ids, the language and logging of mapped Fastify errors, and the startup failure path.
Do them together with `docs/reviews/T03-review.md`, before T04 is fast-forward merged.

## What was verified

All five scripts (`lint`, `typecheck`, `test`, `build`, `format:check`) exit 0 at `main` (`7af398b`); 80 tests pass.
The config schema covers the section 11 table including the Kimi variables, and a missing `MOONSHOT_API_KEY` makes `loadConfig` throw naming it.
Health returns `{ status, version, queueLength: 0 }` without auth.
The error handler maps `ZodError`, `AppError` subclasses and Fastify errors with a known 4xx status onto the documented body; the `INTERNAL` test asserts the log line with stack and `requestId`; the redaction test proves the cookie never reaches the log.
Default messages are Norwegian, `PAYLOAD_TOO_LARGE` is in the section 9 code union, `ExtractionError` and `PayloadTooLargeError` exist, dotenv is loaded only in `index.ts`, and `trustProxy` follows `NODE_ENV`.

## F1 — Required: remove `pool: 'forks'` and its comment from `vitest.config.ts`

The line and the comment were copied from the sibling app.
Vitest 3 documents `@default 'forks'` for `pool` (see `node_modules/vitest/dist/chunks/reporters.d.*.d.ts`), so the setting changes nothing and the comment names a cause nobody verified.
The symptom behind it is the cold-cache first boot described in `docs/reviews/environment.md` E2.

Steps: delete both lines; add `testTimeout: 15000` under `test` with the comment "First Fastify boot on a cold module cache can exceed 5 s on Windows."

Acceptance: `npm test` passes twice in a row.

## F2 — Required: Norwegian message and a `warn` line for mapped Fastify errors

`appErrorFromHttpError` copies Fastify's English message into the body (for malformed JSON: "Unexpected token …"), and nothing is logged for the mapped error.
ADR-0012 says the client shows `message` for every 4xx, so that text is UI text and Norwegian per `AGENTS.md`.
A 4xx status that is not in `CODE_BY_STATUS`, such as 415 for an unsupported content type, falls through to `500 INTERNAL`.

Steps:

1. Build the mapped error through the subclass constructors so their Norwegian defaults apply: 400 `ValidationError`, 401 `UnauthorizedError`, 404 `NotFoundError`, 409 `ConflictError('Konflikt')`, 413 `PayloadTooLargeError`, 429 a new `RateLimitedError` with the default `For mange forsøk. Prøv igjen om et minutt.`.
   Every other 4xx keeps its status with code `VALIDATION_ERROR` and the message `Ugyldig forespørsel`.
2. In the error handler, when the mapping applies, log `request.log.warn({ err: error, requestId }, 'Request rejected')` so the original Fastify error stays available for triage.
3. Tests: malformed JSON returns message `Ugyldig forespørsel` and one level-40 line in the log capture; `content-type: application/xml` returns 415 with code `VALIDATION_ERROR`.

Acceptance: the tests pass, and `grep -n "typeof message === 'string' ? message" src/server/lib/errors.ts` prints nothing.

## F3 — Required: request ids that survive a restart

Fastify's default id is `req-1`, `req-2`, … per process, so ids repeat after every Render restart.

Steps: pass `genReqId: () => randomUUID()` (from `node:crypto`) in the Fastify options; leave `requestIdHeader` at its default.

Acceptance: a test shows two health requests get different ids matching `/^[0-9a-f-]{36}$/`.

## F4 — Required: one log line when `buildApp` fails at startup

Since T03, `buildApp` opens the database and runs migrations, and `index.ts` calls it outside any `try`; an unwritable `DATABASE_PATH` crashes with a raw stack.

Steps: wrap the `buildApp` call in `try`/`catch`; on failure `bootLogger.error({ err: error }, 'Failed to build the app')` and `process.exit(1)`.

Acceptance, run by hand and pasted into the commit body: `DATABASE_PATH=./package.json/x.db npm start` prints one JSON line at level 50 and exits 1.

## F5 — Recommended: SPA fallback only for HTML navigations

In production `GET /assets/missing.js` returns `200` with `index.html`, so a broken deploy looks healthy.

Steps: add `clientDir?: string` to `BuildAppOptions` (default `dist/client`) for both `@fastify/static` and the fallback; serve `index.html` only for `GET` requests whose `accept` header includes `text/html`, and the JSON `NOT_FOUND` body otherwise; test it with a fixture `test/fixtures/client/index.html`.

## F6 — Note for T05

T02 step 3 names `llmClient?` in `buildApp` options and step 6 a `FakeLlmClient` placeholder in `createTestApp`; both are absent.
T05 adds them; no separate action now.

## Done

With the T03 follow-up: the five scripts exit 0, commit bodies carry the summaries, fast-forward merge into `main`.
