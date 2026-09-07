# Kvitteringer — implementation tasks

Ordered tasks for implementing `docs/architecture.md` under the decisions in `docs/adr/`.
Each task is sized for one pull request and written so a smaller model can implement it without further design work.

## Rules for the implementer

The rules and the conventions that apply to every task live in `AGENTS.md` at the repository root.
Read it, then `docs/architecture.md` and every ADR, before starting a task.

## Task overview

| Task | Title | Depends on |
| --- | --- | --- |
| T01 | Scaffold the package, tooling, shared helpers | — |
| T02 | Server skeleton: config, app factory, logging, health, errors, static serving | T01 |
| T03 | Database: Drizzle schema for all tables, migrations, test helper | T02 |
| T04 | Auth: login, logout, me, cookie guard, rate limit | T03 |
| T05 | LLM client: interface, Kimi implementation, fake, JSON parsing | T02 |
| T06 | Image normalisation and receipt upload endpoint | T03, T04 |
| T07 | Extraction prompt, output schema and `applyExtraction` | T05 |
| T08 | Job runner: queue, status transitions, crash recovery, retry endpoint | T06, T07 |
| T09 | Product matching: normalisation, aliases, LLM matching, rematch endpoint | T08 |
| T10 | Receipts and receipt-lines API | T09 |
| T11 | Products API: list with statistics, detail, create, update, merge, alias delete | T09 |
| T12 | Suggestion engine and `GET /api/suggestions` | T11 |
| T13 | Shopping lists API | T12 |
| T14 | Client shell: router, query client, API client, login, auth guard | T01 |
| T15 | Scan flow UI: camera input, downscale, upload, progress, polling | T10, T14 |
| T16 | Receipt review UI | T15 |
| T17 | Products UI | T11, T14 |
| T18 | Shopping list UI | T13, T14 |
| T19 | Receipts list UI, PWA manifest, mobile polish | T16, T17, T18 |
| T20 | Extraction eval harness with real receipts | T07, T05 |
| T21 | Docker, Litestream, Render, restore drill, release checklist | T13, T19 |
| T22 | CI pipeline | T01 |
| T23 | Phase 2: spend statistics and shopping list history | T21 |

T14 can be developed in parallel with T02–T13.
T20 needs real receipt photos from the household; ask for them when starting the task.

---

## T01 — Scaffold the package, tooling, shared helpers

Goal: an empty but fully wired repository where `dev`, `lint`, `typecheck`, `test` and `build` all run, plus the shared pure helpers that many later tasks need.

Files: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `.env.example`, `README.md`, `src/client/index.html`, `src/client/main.tsx`, `src/client/App.tsx`, `src/client/styles.css`, `src/server/index.ts` (placeholder), `src/shared/dates.ts`, `src/shared/money.ts`, `src/shared/categories.ts`, tests under `test/shared/`.

Steps:

1. Initialise git and `package.json` (`private`, `type: module`, Node `>=22`).
2. Dependencies: `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `fastify`, `@fastify/cookie`, `@fastify/static`, `@fastify/rate-limit`, `@fastify/multipart`, `better-sqlite3`, `drizzle-orm`, `zod`, `pino`, `openai`, `sharp`, `dotenv`, `tsx`.
   `tsx` is a regular dependency, not a dev dependency, because the production image installs with `npm ci --omit=dev` and starts the server with `tsx` (ADR-0002, T21).
   Dev: `typescript`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `drizzle-kit`, `vitest`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`, `concurrently`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/better-sqlite3`.
3. Scripts as in the sibling app plus `"eval:extraction": "tsx eval/run.ts"`.
4. `vite.config.ts` with `root: 'src/client'`, `build.outDir: '../../dist/client'`, `emptyOutDir: true`, React and Tailwind plugins, proxy `/api` to `http://localhost:3000`.
   `vitest.config.ts` at the repository root, separate from the Vite config so tests are not scoped to `src/client`: React plugin, `environment: 'node'` as the default, `include: ['test/**/*.test.{ts,tsx}']`, and a `setupFiles` entry for `@testing-library/jest-dom`.
   Every file under `test/client/` starts with `/** @vitest-environment jsdom */`.
   Do not use `environmentMatchGlobs`; it was removed in Vitest 4.
5. Two tsconfigs as in `architecture.md` section 5; ESLint with `no-console: error` for `src/**`.
6. `src/shared/dates.ts`: `isIsoDate`, `diffDays(a, b)` (b − a in whole days), `addDays`, `mondayOf(date)`, `isoWeekKey(date)` returning `YYYY-Www`, `todayLocalIso()` for the client, and `todayInOslo(now = new Date())` for the server, which returns the civil date in `Europe/Oslo` using `Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' })`.
7. `src/shared/money.ts`: `parseNok(value: string | number): number` returning øre (accepts `"43,80"`, `"43.80"`, `"1 234,50"`, `43.8`, negative values; throws on anything else), and `formatOre(ore): string` returning `43,80 kr`.
   Implement `formatOre` with `Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })` followed by a non-breaking space (U+00A0) and `kr`; the negative sign produced by that locale is the Unicode minus U+2212, and tests compare against those exact code points.
8. `src/shared/categories.ts`: `PRODUCT_CATEGORIES` as a readonly tuple and `productCategorySchema = z.enum(PRODUCT_CATEGORIES)`.
9. Minimal `App.tsx` rendering "Kvitteringer"; `.env.example` with every variable from `architecture.md` section 11; README with run instructions and doc links; extend the existing `.gitignore` with `node_modules`, `dist`, `data/` and `.env` while keeping the `.semgrep/` entry.

Acceptance criteria:

- All five scripts exit 0; the dev client shows "Kvitteringer".
- `isoWeekKey('2026-01-01')` is `2026-W01`, `isoWeekKey('2027-01-01')` is `2026-W53`, `mondayOf('2026-09-06')` is `2026-08-31`.
- `parseNok('1 234,50')` is `123450`; `parseNok('-5,00')` is `-500`; `parseNok('abc')` throws.
- `formatOre(4380)` is `'43,80 kr'`; `formatOre(-500)` is `'−5,00 kr'`.
- `todayInOslo(new Date('2026-03-29T23:30:00Z'))` is `2026-03-30` and `todayInOslo(new Date('2026-01-15T23:30:00Z'))` is `2026-01-16`, because Oslo is ahead of UTC in both cases.

Tests: every example above plus year-boundary week cases and `diffDays` across a DST change (dates only, so the result must still be whole days).

---

## T02 — Server skeleton: config, app factory, logging, health, errors, static serving

Goal: Fastify server with validated config, `GET /api/health`, the error format, and static serving in production; identical in structure to the sibling app.

Files: `src/server/config.ts`, `src/server/app.ts`, `src/server/index.ts`, `src/server/lib/errors.ts`, `src/server/routes/health.ts`, `test/server/health.test.ts`, `test/server/errors.test.ts`, `test/server/config.test.ts`, `test/helpers/createTestApp.ts`.

Steps:

1. `config.ts`: zod schema for the table in `architecture.md` section 11 including `MOONSHOT_API_KEY`, `KIMI_MODEL`, `KIMI_BASE_URL`, `KIMI_THINKING`, `KIMI_TIMEOUT_MS`, `MAX_UPLOAD_BYTES`; `loadConfig(env)` throws on failure, `index.ts` logs and exits.
2. `errors.ts`: `AppError`, `NotFoundError`, `ConflictError`, `UnauthorizedError`, `PayloadTooLargeError`, `ExtractionError(userMessage, stage)`, and `toErrorResponse`.
3. `app.ts`: `buildApp(options: { config; databasePath?; llmClient? })`; pino with redaction; `trustProxy: config.nodeEnv === 'production'` so `request.ip` is the real client address behind the Render proxy; `x-request-id` header; `setErrorHandler` per ADR-0012; `setNotFoundHandler` (JSON 404 for `/api/*`, `index.html` otherwise in production); `@fastify/static` for `dist/client` in production.
4. `health.ts`: `GET /api/health` returning `{ status: 'ok', version, queueLength: 0 }` (the queue arrives in T08).
5. `index.ts`: `import 'dotenv/config'` as the first line so a local `.env` is loaded in development (Render supplies real environment variables in production and the import is a no-op without a file); then load config, build, listen, `SIGTERM` handling.
   Only `index.ts` loads dotenv; `app.ts` and tests never read `.env`.
6. `createTestApp.ts`: test config with `MOONSHOT_API_KEY=test-key`, an in-memory database by default (used from T03), an optional `databasePath` so a test can build two apps on the same temporary file, and a `FakeLlmClient` placeholder (used from T05).

Acceptance criteria:

- Health returns 200 without auth.
- Unknown `/api/x` returns the documented 404 body; a thrown `Error` returns `500 INTERNAL` without a stack.
- Missing `MOONSHOT_API_KEY` fails config loading with a message naming the variable.

Tests: health, not-found shape, internal error shape and log, config success and failure.

---

## T03 — Database: Drizzle schema for all tables, migrations, test helper

Goal: all seven tables from `architecture.md` section 6 exist through Drizzle with migrations applied at startup.

Files: `src/server/db/schema.ts`, `src/server/db/client.ts`, `src/server/db/migrate.ts`, `drizzle.config.ts`, `drizzle/0000_initial.sql`, `test/server/db.test.ts`, updates to `app.ts` and `createTestApp.ts`.

Steps:

1. Define `receipts`, `receipt_images`, `products`, `product_aliases`, `receipt_lines`, `shopping_lists`, `shopping_list_items` exactly as in section 6, including check constraints, unique constraints, foreign keys with the stated `ON DELETE` behaviour, and indexes.
2. `openDatabase(path)` with WAL (not for `:memory:`) and `foreign_keys = ON`; `runMigrations(db)` resolving the migrations folder relative to the repository root.
3. Generate and commit the migration; `buildApp` opens, migrates, decorates `db` and `sqlite`, closes on shutdown.

Acceptance criteria:

- Fresh start creates every table; second start is a no-op.
- `receipts.status = 'weird'` is rejected; `receipt_lines.kind = 'x'` is rejected.
- Deleting a receipt removes its image and lines; deleting a product sets `receipt_lines.product_id` to null and removes its aliases.
- Two aliases with the same `alias_normalized` are rejected.

Tests: each bullet above.

---

## T04 — Auth: login, logout, me, cookie guard, rate limit

Goal: the API is closed except login and health, following ADR-0009.

Files: `src/server/plugins/auth.ts`, `src/shared/schemas.ts` (`loginSchema`), `test/server/auth.test.ts`, `test/helpers/login.ts`.

Steps and acceptance criteria are identical to the sibling app with cookie name `kvitteringer_auth` and HMAC message `kvitteringer-v1`:

- Wrong password `401`; sixth attempt in a minute `429`.
- With a production config and `x-forwarded-for` headers, two different forwarded addresses get independent rate-limit counters (proves `trustProxy` is on); with a development config the header is ignored.
- Correct password `204` and cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=31536000`, `Secure` only in production.
- `me` is `401` without or with a tampered cookie and `200` with the real one; health stays open; rotating the secret invalidates cookies.

Tests: each bullet.

---

## T05 — LLM client: interface, Kimi implementation, fake, JSON parsing

Goal: one seam for all LLM access, a Kimi implementation that follows ADR-0003, and a fake for tests.

Files: `src/server/llm/LlmClient.ts`, `src/server/llm/KimiClient.ts`, `src/server/llm/FakeLlmClient.ts`, `src/server/llm/json.ts`, `test/server/llm/KimiClient.test.ts`, `test/server/llm/json.test.ts`, `test/server/llm/FakeLlmClient.test.ts`.

Steps:

0. Verify the ADR-0003 assumption with one manual request before writing code: send any small JPEG as a base64 `image_url` part together with `response_format: { type: 'json_object' }` and `thinking: { type: 'disabled' }` to `kimi-k2.6` with `curl`, and record the outcome in the PR description.
   If the API rejects the combination, stop and ask; the documented fallback is in `architecture.md` section 7.3.
   This is a one-off manual check that costs a fraction of a krone, not a test.
1. `LlmClient.ts`:

```ts
export type JsonCompletionRequest = {
  purpose: 'extract' | 'match';
  system: string;
  userText: string;
  imageDataUrl?: string;      // data:image/jpeg;base64,...
  maxTokens: number;
  promptVersion: number;
  receiptId?: number;
};
export type JsonCompletionResult = {
  text: string;
  finishReason: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  durationMs: number;
};
export interface LlmClient {
  completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult>;
}
```

2. `KimiClient`: constructed with `{ apiKey, baseURL, model, thinking, timeoutMs, logger }`; builds the OpenAI SDK client with `maxRetries: 2`; `completeJson` builds messages (system, then user with optional `image_url` part followed by the text part), sets `response_format: { type: 'json_object' }`, `max_tokens`, and the extra body field `thinking: { type }`; does not set `temperature`; logs the one `info` line from ADR-0012; maps SDK errors to `ExtractionError` with the Norwegian messages from `architecture.md` section 7.3.
   Expose a `buildRequestBody(request)` function so the exact body can be unit tested without network.
3. `FakeLlmClient`: constructed with a queue of scripted results or a function `(request) => result`; records every request in `.requests`; throws a clear error when the script is exhausted.
4. `json.ts`: `parseJsonObject(text)` that strips a leading or trailing markdown code fence if present, parses, and throws `ExtractionError('Kunne ikke tolke svaret fra lesingen', stage)` on failure or when the result is not a plain object.
5. `buildApp` accepts `llmClient` in options and otherwise constructs a `KimiClient` from config; `createTestApp` injects a `FakeLlmClient`.

Acceptance criteria:

- `buildRequestBody` output has `model`, `response_format.type === 'json_object'`, `max_tokens`, `thinking.type`, no `temperature`, the image part before the text part, and the system message first.
- `parseJsonObject` handles a plain object, a fenced object, and rejects an array and invalid JSON.
- `FakeLlmClient` returns scripted results in order and records requests.
- The PR description records the result of the manual JSON-mode-with-image check from step 0.

Tests: each bullet; no network in any test.

---

## T06 — Image normalisation and receipt upload endpoint

Goal: `POST /api/receipts` accepts a photo, normalises it, detects duplicates, stores it, and returns `202`.

Files: `src/server/lib/images.ts`, `src/server/routes/receipts.ts` (upload only), `src/shared/schemas.ts` (`receiptSummarySchema`), `test/server/images.test.ts`, `test/server/receiptsUpload.test.ts`, `test/fixtures/images/receipt-small.jpg`, `test/fixtures/images/rotated.jpg` (EXIF orientation 6), `test/fixtures/images/not-an-image.txt`.

Steps:

1. Register `@fastify/multipart` with `limits.fileSize = config.maxUploadBytes` and `files: 1`.
2. `normaliseImage(buffer)`: `sharp(buffer).rotate()`, metadata check (`jpeg`, `png`, `webp` only), resize `{ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }`, `.jpeg({ quality: 85 })`, return `{ bytes, width, height, sha256 }`.
   Throw a `ValidationError`-style `AppError(400)` for unsupported formats.
3. Upload handler: read the single file part, enforce size (a `413 PAYLOAD_TOO_LARGE` when multipart reports truncation), normalise, check `sha256` uniqueness (`409 CONFLICT` with `details.existingReceiptId`), insert `receipts` (`pending`) and `receipt_images` in one transaction, call `enqueue(id)` (a no-op stub until T08), reply `202 { id }`.
4. `GET /api/receipts/:id/image` streaming the stored bytes with `Content-Type` and `Cache-Control: private, max-age=86400`.

Acceptance criteria:

- Uploading `receipt-small.jpg` returns `202` and the image endpoint returns a JPEG with the normalised dimensions.
- Uploading `rotated.jpg` produces an image whose width and height are swapped relative to the raw pixel data (rotation applied).
- Uploading the same file twice returns `409` with the first id.
- Uploading `not-an-image.txt` returns `400`; a file over the limit returns `413`.
- Without auth the upload returns `401`.

Tests: each bullet using `app.inject()` with a multipart body.
Build the body with the global `FormData` and `Blob` from Node 22 and pass the `FormData` object as `payload`; `light-my-request` serialises it.
If the installed version does not accept `FormData`, write a small boundary-based builder in `test/helpers/multipart.ts` instead of adding a dependency.

---

## T07 — Extraction prompt, output schema and `applyExtraction`

Goal: everything between "we have an image" and "we have receipt fields, lines and warnings", without touching the queue yet.

Files: `src/server/llm/prompts/extractReceipt.prompt.ts`, `src/server/llm/extractReceipt.ts`, `src/server/domain/extraction.ts`, `test/server/llm/extractReceipt.test.ts`, `test/server/domain/extraction.test.ts`, `test/fixtures/llm/extract-rema.json`, `test/fixtures/llm/extract-comma-decimals.json`, `test/fixtures/llm/extract-missing-date.json`, `test/fixtures/llm/extract-malformed.txt`, `test/fixtures/llm/extract-odd-units.json`, `test/fixtures/llm/extract-footer-lines.json`.

Steps:

1. Write the system prompt per `architecture.md` section 7.3, with `EXTRACT_PROMPT_VERSION = 1`.
   Include the complete example object and a field-by-field description, the Norwegian conventions list, the rule that `text` is copied as printed, and the rule that subtotal, total, VAT, payment, change, card and loyalty lines are left out of `lines`.
2. `extractReceipt.ts`: `extractionResultSchema` (zod, with `z.preprocess` steps that accept numbers or decimal-comma strings via `parseNok` for `total`, `unitPrice`, `totalPrice` and `quantity`, and that apply the lenient normalisation from `architecture.md` section 7.3: unknown `kind` → `other`, bad `quantity` → `1`, unit conversion for `g`, `hg`, `ml`, `cl`, `dl`, unknown `unit` → `null` with `quantity 1`), `buildExtractionRequest(imageDataUrl, receiptId)`, and `parseExtraction(text)` that uses `parseJsonObject` and the schema, throwing `ExtractionError` with the documented message on failure.
3. `runExtraction(llm, image, receiptId)`: builds the request, calls `completeJson`, throws `ExtractionError('Kvitteringen var for lang til å leses', 'extraction')` when `finishReason === 'length'`, returns `{ result, raw, model, promptVersion, usage }`.
4. `domain/extraction.ts`: `applyExtraction(result, scanDate)` per section 7.4, returning `{ storeName, purchasedAt, totalOre, warnings, lines }` where lines have øre integers and `lineNo`.

Acceptance criteria:

- The REMA fixture parses to 4 lines with `totalOre 45890` and no warnings when the sum matches.
- The comma-decimal fixture (`"total": "458,90"`) parses to the same øre values.
- The missing-date fixture yields `purchasedAt = scanDate` and `MISSING_DATE`.
- A total off by 1,50 kr yields `TOTAL_MISMATCH`; off by 0,50 kr does not.
- The odd-units fixture parses without error: `unit: 'g', quantity: 500` becomes `quantity 0.5, unit 'kg'`; `unit: 'dl', quantity: 5` becomes `quantity 0.5, unit 'l'`; `unit: 'pk'` becomes `unit null, quantity 1`; `kind: 'refund'` becomes `other`.
- The footer-lines fixture, which contains a copied `SUM 458,90` line with `kind: 'other'`, yields no `TOTAL_MISMATCH`, because `other` lines are excluded from the line sum.
- A result without any `item` lines throws `ExtractionError` with "Fant ingen varelinjer".
- The malformed fixture throws with "Kunne ikke tolke svaret fra lesingen".

Tests: each bullet, using `FakeLlmClient` for `runExtraction`.

---

## T08 — Job runner: queue, status transitions, crash recovery, retry endpoint

Goal: uploads get processed in the background with persisted status per ADR-0006; matching is a stub until T09.

Files: `src/server/jobs/receiptProcessor.ts`, `src/server/routes/receipts.ts` (`GET /:id`, `POST /:id/retry`), `test/server/jobs/receiptProcessor.test.ts`, `test/server/receiptsProcessing.test.ts`.

Steps:

1. `createReceiptProcessor({ db, sqlite, llm, logger, now })` returning `{ enqueue(id), requeueUnfinished(), queueLength(), drain(): Promise<void> }`.
   `drain()` resolves when the queue is empty; tests use it instead of timers.
2. `processReceipt(id)`: set `processing` and `attempts + 1`; load image bytes; build the data URL; `runExtraction`; `applyExtraction` with `todayInOslo()`; run `findPossibleDuplicate` from `architecture.md` section 7.4 and, on a hit, add `POSSIBLE_DUPLICATE` and set `possible_duplicate_of`; in one transaction delete any lines left by an earlier attempt, update the receipt (`store_name`, `purchased_at`, `total_ore`, `warnings_json`, `extraction_json`, `raw_response`, `prompt_version`, `model`, `possible_duplicate_of`) and insert the new lines, so a retried job never duplicates data; call `matchLines` (stub returning no changes until T09); set `done`.
   On error: set `failed`, `error_message` = the `ExtractionError` user message or "Ukjent feil under lesing", log at `error` with `receiptId`, `attempts`, `stage`.
3. `requeueUnfinished()` selects `pending` and `processing` ids ordered by id and enqueues them; `buildApp` calls it after migrations.
4. `GET /api/receipts/:id` returns `ReceiptDetail` (lines join products; `imageUrl`).
5. `POST /api/receipts/:id/retry`: `409` unless `failed`; set `pending`, clear `error_message`, enqueue, return `202 ReceiptSummary`.
6. Health reports `queueLength`.

Acceptance criteria:

- Upload then `drain()` leaves the receipt `done` with lines from the fake response and `attempts = 1`.
- A fake that throws leaves the receipt `failed` with the Norwegian message; retry then success leaves it `done` with `attempts = 2`.
- A receipt manually set to `processing` before `buildApp` is processed after startup: build the app on a temporary database file (`fs.mkdtemp`), upload and set the status, close the app, build a second app on the same file with a fake that succeeds, `drain()`, and assert `done`.
- Two uploads process sequentially in id order (assert via the fake request order).
- A receipt that already has lines from an interrupted attempt (insert two lines directly and set `processing`) ends with exactly the lines of the new attempt and no duplicates.
- A second receipt whose extraction has the same store, date and total as a `done` receipt gets `POSSIBLE_DUPLICATE` and `possibleDuplicateOf` pointing at it; a receipt with a different total does not.

Tests: each bullet.

---

## T09 — Product matching: normalisation, aliases, LLM matching, rematch endpoint

Goal: item lines get canonical products per ADR-0004.

Files: `src/server/lib/normalize.ts`, `src/server/llm/prompts/matchProducts.prompt.ts`, `src/server/llm/matchProducts.ts`, `src/server/domain/matching.ts`, `src/server/routes/receipts.ts` (`POST /:id/rematch`), `test/server/normalize.test.ts`, `test/server/domain/matching.test.ts`, `test/fixtures/llm/match-basic.json`, `test/fixtures/llm/match-partial.json`.

Steps:

1. `normalizeText(s)` per `architecture.md` section 6.
2. Prompt with `MATCH_PROMPT_VERSION = 1`: input lists (unmatched texts, known product names, categories), naming guidance from section 7.5, one example output.
3. `matchProducts.ts`: `matchResultSchema`, `buildMatchRequest(texts, knownNames, receiptId)`, `parseMatches(text)`.
4. `domain/matching.ts`: `matchLines({ db, sqlite, llm, logger, receiptId })` implementing steps 1–6 of section 7.5, returning `{ matchedByAlias, matchedByLlm, unmatched, warnings }`.
   Known product names: non-suppressed, ordered by count of item lines descending, at most 1 000.
5. Wire `matchLines` into the processor; append its warnings to the receipt.
6. `POST /api/receipts/:id/rematch`: runs `matchLines` for lines with `product_id IS NULL`, updates warnings, returns `ReceiptDetail`.

Acceptance criteria:

- A text with an existing alias is linked without any LLM request (assert `fake.requests` is empty).
- Two unknown texts trigger exactly one LLM request containing both texts and the known names.
- `existingProduct: "Lettmelk 1 l"` links to the existing product and creates an `llm` alias; `existingProduct: null` creates a new product with the category and an alias.
- A `newProductName` whose normalized form equals an existing product links instead of duplicating.
- A text missing from the LLM response stays unmatched and adds `UNMATCHED_LINES`; an LLM failure leaves the receipt `done` with `MATCHING_FAILED`; rematch fixes it when the fake then succeeds.
- Discount and deposit lines never appear in LLM requests.

Tests: each bullet plus the `normalizeText` examples from `architecture.md` section 6 (registered sign and punctuation to space, `ü` and Norwegian letters preserved, digits kept, whitespace collapsed).

---

## T10 — Receipts and receipt-lines API

Goal: the remaining receipt endpoints from `architecture.md` section 9.

Files: `src/server/routes/receipts.ts`, `src/server/routes/receiptLines.ts`, `src/shared/schemas.ts` (receipt and line schemas), `test/server/receipts.test.ts`, `test/server/receiptLines.test.ts`.

Steps:

1. `GET /api/receipts?limit&before`: newest first, `limit` 1–100 default 50, `before` cursor on id; `lineCount` via a grouped subquery.
2. `PATCH /api/receipts/:id`: only when `done` (`409` otherwise); validate fields; recompute `TOTAL_MISMATCH` against the line sum and re-run `findPossibleDuplicate` when `storeName`, `purchasedAt` or `totalOre` change; `reviewed: true` sets `reviewedAt`.
3. `DELETE /api/receipts/:id`.
4. `PATCH /api/receipt-lines/:id` per section 7.6: `{ productId }` or `{ newProductName, category? }` (exactly one), set `match_source = 'user'`, upsert the `user` alias for `normalizeText(raw_text)`, return the line with its product.

Acceptance criteria:

- Pagination returns disjoint pages in descending id order.
- Patching total to a mismatching value adds `TOTAL_MISMATCH`; patching it back removes it.
- Patching a receipt so that store, date and total equal another `done` receipt adds `POSSIBLE_DUPLICATE` with `possibleDuplicateOf`; changing the total again removes both.
- Correcting a line to a new product creates the product and a `user` alias; a later receipt with the same text maps to it by alias.
- Correcting a line replaces an existing `llm` alias with the `user` alias.

Tests: each bullet plus 404 and validation cases.

---

## T11 — Products API: list with statistics, detail, create, update, merge, alias delete

Goal: manage canonical products and see how often they are bought.

Files: `src/server/routes/products.ts`, `src/server/domain/merge.ts`, `src/server/domain/productStats.ts`, `src/shared/schemas.ts` (product schemas), `test/server/products.test.ts`, `test/server/domain/merge.test.ts`.

Steps:

1. `productStats.ts`: for each product compute `timesBought` (distinct receipt dates with an item line), `lastBought`, `medianIntervalDays` (null with fewer than two dates) using purchases from `done` receipts; expose `loadProductHistories(db)` returning the `ProductHistory[]` shape used by the suggestion engine in T12.
2. `GET /api/products?q&includeSuppressed`: filter with `normalizeText(q)` contains; order by `timesBought` desc, then name.
3. `GET /api/products/:id` with aliases and purchases (newest first).
4. `POST`, `PATCH` with uniqueness on `name_normalized` (`409`).
5. `mergeProducts(sqlite, db, sourceId, targetId)` in one transaction: move lines, move aliases (skip ones that already exist on the target), add `normalizeText(source.name)` as an alias of the target if free, delete the source.
   `400` when ids are equal, `404` when either is missing.
6. `DELETE /api/product-aliases/:id`.

Acceptance criteria:

- Statistics match a hand-computed fixture (three receipts, two products).
- Search is case- and punctuation-insensitive.
- Merge moves everything, leaves no dangling lines, and a subsequent receipt with the source name maps to the target.
- Renaming to an existing name returns `409`.

Tests: each bullet.

---

## T12 — Suggestion engine and `GET /api/suggestions`

Goal: the deterministic algorithm from `architecture.md` section 8 and ADR-0008.

Files: `src/server/domain/suggestions.ts`, `src/server/routes/suggestions.ts`, `test/server/domain/suggestions.test.ts`, `test/fixtures/suggestions/*.json`.

Steps:

1. Implement `computeSuggestions(histories, today)` exactly as specified, with the thresholds as named constants.
2. `GET /api/suggestions` loads histories with `loadProductHistories` and returns the result with `today = todayInOslo()`.

Acceptance criteria:

- The worked example in section 8 produces exactly: milk suggested with score 1.0 and the "Kjøpes ca. hver 7. dag" reason, coffee suggested, flour skipped as stale, bananas skipped as bought this trip.
- One test per rule: fewer than two purchase weeks (including two purchases in the same ISO week), bought within three days, stale, due rule alone, frequency rule alone, suppressed.
- A product bought every week has `medianGap 7`; one bought in weeks 30 and 33 has `medianGap 21`.
- Quantity text: median 2 stk gives `2 stk`; median 1.135 kg gives `1,1 kg`.
- Sorting by score then name is stable.

Tests: each bullet; no database needed for the pure function.

---

## T13 — Shopping lists API

Goal: create a list from suggestions and manage it.

Files: `src/server/routes/shoppingLists.ts`, `src/shared/schemas.ts` (list schemas), `test/server/shoppingLists.test.ts`.

Steps:

1. `POST /api/shopping-lists`: return the open list with `200` if one exists; otherwise create with `weekStart = mondayOf(todayInOslo())`, insert one `suggested` item per suggestion in rank order with `reason` and `quantityText`, return `201`.
2. `GET /api/shopping-lists/current` (`404` when none open).
3. `POST /api/shopping-lists/:id/items` (manual, appended, optional `productId`), `PATCH /api/shopping-list-items/:id`, `DELETE /api/shopping-list-items/:id`, `POST /api/shopping-lists/:id/complete`.
4. Mutations on a `done` list return `409`.

Acceptance criteria:

- Creating twice returns the same list.
- Items are ordered by position; a manual item lands last.
- Completing sets `done` and `completedAt`, after which `current` is `404` and a new list can be created.

Tests: each bullet.

---

## T14 — Client shell: router, query client, API client, login, auth guard

Goal: SPA skeleton ready for pages; same structure as the sibling app.

Files: `src/client/main.tsx`, `src/client/App.tsx`, `src/client/api/client.ts`, `src/client/api/queries.ts`, `src/client/pages/LoginPage.tsx`, `src/client/components/AppShell.tsx`, `src/client/components/Toast.tsx`, `src/client/lib/format.ts`, tests `test/client/LoginPage.test.tsx`, `test/client/apiClient.test.ts`.

Steps:

1. `fetchJson` with `ApiError`, `onUnauthorized` (clear cache, go to `/login`), and `uploadFile(path, file, onProgress)` using `XMLHttpRequest` for progress.
2. Routes from `architecture.md` section 10; `RequireAuth` wrapper; bottom navigation with four tabs.
3. `LoginPage` with "Feil passord" and "Prøv igjen om litt".
4. `format.ts`: `formatDate('2026-09-03')` → `3. sep. 2026`, `formatRelativeDate`, re-export `formatOre`.

Acceptance criteria:

- Unauthenticated visit shows login; after login the shell shows four tabs.
- A `401` anywhere navigates to `/login`.

Tests: `fetchJson` error parsing and `onUnauthorized`; `LoginPage` messages.

---

## T15 — Scan flow UI: camera input, downscale, upload, progress, polling

Goal: the "after shopping" scenario from photo to processing screen.

Files: `src/client/lib/downscaleImage.ts`, `src/client/pages/ScanPage.tsx`, `src/client/pages/ReceiptPage.tsx` (processing and failed states only), `src/client/components/ReceiptStatusBadge.tsx`, `src/client/api/queries.ts` (`useUploadReceipt`, `useReceipt` with conditional `refetchInterval`, `useRetryReceipt`), tests `test/client/downscaleImage.test.ts`, `test/client/ScanPage.test.tsx`, `test/client/ReceiptPageProcessing.test.tsx`.

Steps:

1. `downscaleImage(file, { maxEdge: 2000, quality: 0.85 }): Promise<Blob>` using `createImageBitmap` when available, else an `Image`, drawn to a canvas; returns the original file when it is already a JPEG under 500 KB and within the size limit.
2. `ScanPage`: two buttons bound to hidden file inputs (with and without `capture="environment"`), preview thumbnail, "Bruk" triggers downscale and upload with a progress bar, then navigates to `/receipts/:id`.
   On `409`, navigate to `details.existingReceiptId` with the toast "Denne kvitteringen er allerede skannet".
3. `ReceiptPage` processing state: thumbnail from `imageUrl`, "Leser kvittering…" with a spinner and elapsed seconds; `failed` state with the error message and "Prøv igjen"; polling every 2 s only while `pending` or `processing`.

Acceptance criteria:

- A 4000 × 3000 test image becomes at most 2000 px on the long edge (mock canvas in jsdom or test the size math in isolation).
- Upload progress reaches 100 % and the page navigates to the receipt.
- Polling stops when the status becomes `done` or `failed` (assert with a mocked query hook).

Tests: each bullet with mocked API.

---

## T16 — Receipt review UI

Goal: review and correct a processed receipt.

Files: `src/client/pages/ReceiptPage.tsx` (done state), `src/client/components/ReceiptLineRow.tsx`, `src/client/components/ProductPicker.tsx`, `src/client/api/queries.ts` (`useUpdateReceipt`, `useUpdateReceiptLine`, `useRematch`, `useDeleteReceipt`, `useProductSearch`), tests `test/client/ProductPicker.test.tsx`, `test/client/ReceiptPageDone.test.tsx`.

Steps:

1. Header: store, date and total editable inline; warnings shown as chips with Norwegian texts (`TOTAL_MISMATCH` → "Summen av linjene stemmer ikke med totalen", `POSSIBLE_DUPLICATE` → "Ligner på kvittering #{id}, er den skannet to ganger?" linking to `/receipts/{possibleDuplicateOf}`, and so on for every code in `architecture.md` section 6).
2. Lines: item lines show raw text, quantity and unit, amount, and the product name with a picker; discount and deposit lines are greyed out without a picker.
3. `ProductPicker`: debounced search against `/api/products?q=`, keyboard and touch friendly, "Opprett «…»" option that sends `newProductName`.
4. Actions: "Prøv matching igjen" when there are unmatched lines, "Ferdig" that sets `reviewed`, "Slett kvittering" with confirmation.

Acceptance criteria:

- Changing a product on a line updates the row without reload and shows a toast.
- Warning chips appear for every code present and none otherwise.
- The `POSSIBLE_DUPLICATE` chip links to the other receipt.
- The picker shows the create option only when no exact normalized match exists.

Tests: each bullet with mocked hooks.

---

## T17 — Products UI

Goal: browse and curate products.

Files: `src/client/pages/ProductsPage.tsx`, `src/client/pages/ProductPage.tsx`, `src/client/api/queries.ts` (products hooks), tests `test/client/ProductsPage.test.tsx`, `test/client/ProductPage.test.tsx`.

Steps:

1. `ProductsPage`: search field, list rows with name, category, "kjøpt N ganger", "sist {relative date}", interval "ca. hver N. dag"; toggle "Vis skjulte".
2. `ProductPage`: rename, category select from `PRODUCT_CATEGORIES`, "Ikke foreslå" toggle, "Slå sammen med…" using `ProductPicker` and a confirmation, aliases list with delete, purchase history list linking to receipts.

Acceptance criteria:

- Search filters as you type with a 200 ms debounce.
- Merge navigates to the target product and the source disappears from the list.
- Toggling suppression updates the row badge.

Tests: rendering and actions with mocked hooks.

---

## T18 — Shopping list UI

Goal: the "before shopping" and "in the store" scenarios.

Files: `src/client/pages/ShoppingListPage.tsx`, `src/client/components/SuggestionCard.tsx`, `src/client/components/ShoppingListItemRow.tsx`, `src/client/api/queries.ts` (suggestions and list hooks), tests `test/client/ShoppingListPage.test.tsx`.

Steps:

1. No open list: show suggestions as cards with reason and quantity, and a "Lag handleliste" button.
2. Open list: unchecked items first, checked items below in a collapsed group; tap to toggle (optimistic); swipe or button to remove; add field at the bottom with `ProductPicker` or free text; "Ferdig handlet" with confirmation.
3. Show `reason` as secondary text on suggested items.

Acceptance criteria:

- Creating a list moves from the preview to the list view.
- Checking an item moves it to the checked group immediately and reverts on API failure with a toast.
- Completing returns to the suggestions preview.

Tests: each bullet with mocked hooks.

---

## T19 — Receipts list UI, PWA manifest, mobile polish

Goal: the remaining screen and installability.

Files: `src/client/pages/ReceiptsPage.tsx`, `src/client/public/manifest.webmanifest`, icons, `index.html` meta tags, CSS adjustments.

Steps:

1. `ReceiptsPage`: newest first, store, date, `formatOre(total)`, status badge, warning count; infinite scroll or "Last flere" using the `before` cursor.
2. "Skann" on each `uploaded` row and "Skann alle (n)" above the list, calling `POST /api/receipts/:id/scan` per receipt.
3. Manifest name "Kvitteringer", `display: standalone`, icons 192 and 512 px, apple touch icon, theme colour, `viewport-fit=cover`, safe-area padding.
4. Walk every page at 360 × 780 and 1280 px and fix overflow and tap targets.

Acceptance criteria:

- On the production build served by the server, Chrome DevTools → Application → Manifest shows no errors or warnings.
- Chrome on Android offers "Installer app" for the served build, and iOS Safari "Legg til på Hjem-skjerm" installs an icon that opens standalone without browser chrome; record both checks with screenshots in the PR.
- No horizontal scroll at 360 px; all tap targets at least 44 px.

Tests: `ReceiptsPage` rendering and pagination with mocked hooks; manual checks documented in the PR.

---

## T20 — Extraction eval harness with real receipts

Goal: measure extraction quality on real receipts before any prompt or model change (ADR-0014).

Files: `eval/run.ts`, `eval/README.md`, `eval/receipts/*.jpg`, `eval/receipts/*.expected.json`, `eval/results/.gitkeep`.

Steps:

1. Ask the household for at least ten receipt photos from different stores; downscale them with the same `sharp` pipeline and store them in `eval/receipts/`.
2. Write `*.expected.json` by hand for each: `storeName`, `purchasedAt`, `total` (NOK), `items: [{ text, totalPrice }]`.
3. `eval/run.ts`: for each receipt call `runExtraction` with the real `KimiClient` from config, then compute per receipt: `dateMatch`, `storeMatch` (normalized expected store is contained in the normalized extracted store), `totalWithin1kr`, `itemRecall` (share of expected item texts found by normalized equality), `priceAccuracy` (share of matched items with the same øre total), `lineCountDiff`, tokens and duration.
   Print a table and aggregates, write `eval/results/<date>-v<promptVersion>-<model>.json`.
4. `eval/README.md`: how to run, what the metrics mean, the rule that prompt changes need a run, and the target of at least 90 % on `totalWithin1kr` and `itemRecall`.

Acceptance criteria:

- `npm run eval:extraction` runs end to end against the real API and writes a results file.
- The first results file is committed as the baseline.
- The eval never runs from `npm test` or CI.

Tests: unit test the metric functions with a hand-made expected and extracted pair.

---

## T21 — Docker, Litestream, Render, restore drill, release checklist

Goal: production deployment per ADR-0011.

Files: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `litestream.yml`, `start.sh`, `render.yaml`, README deploy section, `docs/release-checklist.md`.

Steps:

1. Dockerfile per ADR-0011; verify that the runtime dependencies load in the final image with a build step `RUN node -e "require('sharp'); require.resolve('tsx')"`, so a missing native binary or a `tsx` that slipped into dev dependencies fails the build instead of the container start.
2. `start.sh`, `litestream.yml`, `render.yaml` per ADR-0011 with `MOONSHOT_API_KEY` as a secret.
3. Restore drill: run with compose and a bucket, scan a receipt, stop, delete the volume, start, confirm the receipt and its image are back.
4. `docs/release-checklist.md`: login, scan from a phone camera, review and correct a line, merge two products, create a shopping list, check off items, complete, install on home screen, retry a failed receipt (simulate with an invalid API key).

Acceptance criteria:

- `docker compose up --build` serves the app; health returns 200 with `queueLength`.
- Restore drill recovers receipt data and image bytes.
- Render deploy passes the health check and a real scan completes.

Tests: none automated; paste the drill output in the PR.

---

## T22 — CI pipeline

Goal: every pull request is checked automatically.

Files: `.github/workflows/ci.yml`.

Steps:

1. Trigger on `pull_request` and push to `main`; Node 22; `npm ci`; `lint`, `typecheck`, `test`, `build`.
2. A second job builds the Docker image without pushing.
3. Make sure `MOONSHOT_API_KEY` is not needed by any test; CI must pass without secrets.

Acceptance criteria:

- Green on a docs-only PR; red on a deliberate lint error (verify once, revert).

---

## T23 — Phase 2: spend statistics and shopping list history

Goal: simple insight into spending and past lists.

Files: `src/server/routes/stats.ts`, `src/server/routes/shoppingLists.ts` (`GET /api/shopping-lists`), a `/stats` page or a section on the receipts page, tests.

Steps:

1. `GET /api/stats/summary?months=6`: per month `totalOre` and receipt count from `done` receipts, plus top ten products by `timesBought`.
2. `GET /api/shopping-lists?limit=20` for history.
3. A simple bar list of monthly totals (no chart library needed) and a top-products list.

Acceptance criteria:

- Monthly totals match a fixture with receipts across three months.
- The history shows completed lists with their week and item count.

Tests: API and rendering.

---

## T24 — Upload and scan as two operations, several photos at a time

Goal: upload many receipt photos quickly, then scan them as a separate step.

Files: `src/server/db/schema.ts` and a migration for the `status` check, `src/server/routes/receipts.ts` (`201` on upload, `scan` replaces `retry`), `src/shared/schemas.ts`, `src/client/pages/ScanPage.tsx`, `src/client/pages/ReceiptPage.tsx` (`uploaded` state, `Prøv igjen` calls scan), `src/client/components/ReceiptStatusBadge.tsx`, `src/client/api/queries.ts` (`useScanReceipt`, `useReceipts` if missing), tests for all of it.

Steps:

1. Docs as in `docs/reviews/T24-plan.md`, own commit.
2. Server: status `uploaded`, migration, `POST /api/receipts` replies `201` and does not enqueue, `POST /api/receipts/:id/scan` for `uploaded` and `failed`, `retry` removed.
3. Client: ScanPage list upload with per-file state, `Skann alle (n)`, ReceiptPage `uploaded` state, badge text, `Prøv igjen` through scan.
4. Playwright walk with three photos, screenshots under `docs/reviews/screenshots/T24/`.

Acceptance criteria:

- Picking three photos uploads all three one after the other, each ending as "Lastet opp"; three receipts have status `uploaded` and the processor has not been called.
- A photo that already exists shows "Allerede skannet" with a link and the remaining files still upload.
- "Skann alle (3)" moves the three to `pending` and they reach `done` or `failed` without further input.
- "Prøv igjen" on a `failed` receipt and "Skann" on an `uploaded` one both call `POST /api/receipts/:id/scan`; `done`, `pending` and `processing` answer `409`.
- A server restart does not scan `uploaded` receipts.

Tests: scan route (401, `uploaded` → 202 `pending`, `failed` → 202, `done` → 409), upload returns 201 without enqueue, requeue ignores `uploaded`, ScanPage with three mocked files (order, per-file state, one 409), `Skann alle` calls scan per id and navigates, ReceiptPage `uploaded` state, badge label.

---

## T25 — Recompute `UNMATCHED_LINES` after a manual match

Goal: the unmatched warning disappears once every item line has a product.

Files: `docs/architecture.md` PATCH receipt-lines row, `src/server/routes/receiptLines.ts`, its tests.

Steps:

1. Docs row: `PATCH /api/receipt-lines/:id` removes `UNMATCHED_LINES` from the receipt when no item line has `product_id IS NULL`; `MATCHING_FAILED` is left alone.
2. Implement inside the existing transaction; return the line as before.

Acceptance criteria:

- Matching the last unmatched line removes `UNMATCHED_LINES` from `GET /api/receipts/:id`; matching one of two leaves it.

---

## T26 — Product matching in batches

Goal: a long receipt never loses all its matches to one truncated answer.

Files: `src/server/domain/matching.ts`, `src/server/llm/matchProducts.ts`, `src/server/llm/KimiClient.ts` if the finish reason is not yet surfaced to callers, tests.

Steps: see `docs/reviews/T26-plan.md`.

Acceptance criteria:

- 45 distinct unmatched texts produce three LLM calls of 20, 20 and 5 texts with `maxTokens` 3200, 3200 and 950.
- When the second batch answers with `finishReason: 'length'`, the matches from batches one and three are saved, the receipt gets `MATCHING_FAILED`, and the error log carries `finishReason` and `batchSize`.
- A receipt with 5 unmatched texts behaves exactly as before.

---

## T27 — Grok (xAI) as a selectable LLM provider

Goal: run extraction and matching on Kimi or Grok, chosen per installation, and compare them with the eval harness.

Files: `src/server/config.ts`, `src/server/llm/OpenAiCompatibleClient.ts` (renamed from `KimiClient.ts`), `src/server/app.ts`, `eval/run.ts`, `src/server/routes/health.ts`, `.env.example`, `render.yaml`, `docs/adr/0015-*.md`, tests.

Steps:

1. Docs as in `docs/reviews/T27-plan.md`, own commit.
2. Config: `LLM_PROVIDER`, `XAI_API_KEY`, `XAI_MODEL`, `XAI_BASE_URL`; the provider's key is required, the other's optional.
3. Client: provider-aware request body (`thinking` only for Kimi), one factory used by `app.ts` and `eval/run.ts`.
4. Health reports `model`.

Acceptance criteria:

- With `LLM_PROVIDER=kimi` the request body is unchanged from today, including `thinking`.
- With `LLM_PROVIDER=grok` the request body has no `thinking` field, goes to `XAI_BASE_URL` with `XAI_MODEL`, and `GET /api/health` reports that model.
- Starting with `LLM_PROVIDER=grok` and no `XAI_API_KEY` refuses to start with a clear message; the same for `kimi` without `MOONSHOT_API_KEY`.
- The default is `kimi` and `npm test` passes without either key.

Tests: config validation for both providers, request-body building for both, health `model`, eval client factory picking the provider.

---

## T28 — Keep long receipt images legible

Goal: a 56-line receipt is read from an image where the digits are legible, not from a 149 px wide strip.

Files: `src/server/lib/images.ts`, `src/client/lib/downscaleImage.ts`, `src/server/llm/extractReceipt.ts`, `src/server/llm/prompts/extractReceipt.prompt.ts`, tests.

Steps: see `docs/reviews/T28-plan.md`.

Acceptance criteria:

- A 600×8000 image is stored as 600×8000; a 3000×20000 image is stored as 1600×10667; neither is enlarged.
- A stored 1600×10667 image is sent as six consecutive segments with 120 px overlap; a 1200×1600 image is sent as one.
- The four Kiwi receipts in `eval/receipts/` are re-run through the eval once their expected JSON exists, and `totalWithin1krRate` and `meanItemRecall` are recorded in the results file committed with the PR.
