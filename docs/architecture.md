# Kvitteringer — architecture

Status: accepted design, not yet implemented.
Date: 2026-09-05.
Decisions referenced as `ADR-NNNN` live in `docs/adr/`.

## 1. Purpose

Kvitteringer keeps track of what a household buys at the grocery store and how often.
A household member photographs the paper receipt after each weekly shop.
An LLM (Kimi, Moonshot AI) reads the photo and returns the lines.
The app maps each line to a canonical product, keeps purchase history per product, and uses that history to suggest a shopping list for the next weekly trip.

The household shops about once a week, so all frequency logic is built around weekly trips.

### In scope (MVP)

- Log in with the shared household password.
- Upload one or more receipt photos from the camera or the photo library, start the scan as a separate step, and follow processing status.
- Automatic extraction of store, date, total and lines, with sanity warnings.
- Automatic mapping of lines to canonical products; deterministic for lines seen before, LLM-assisted for new ones.
- Review a receipt: correct store, date, total, and the product mapping of any line.
  Corrections teach the mapping so the same receipt text maps correctly next time.
- Product list with purchase count, last purchase and typical interval; rename, categorise, merge, and mark "do not suggest".
- Suggested shopping list for the coming trip based on purchase history, editable, with check-off in the store.
- Installable on a phone home screen (PWA manifest), mobile-first layout.

### Out of scope (MVP)

- Price comparison, store price history, or recipe features (the `shopper` app does those).
- Offline scanning and background sync.
- Multiple households or per-person data.
- Spending statistics beyond a simple per-month total (planned phase 2, task T20).
- Learning quantities per recipe or meal plan.

## 2. Usage scenarios

1. After shopping.
   Open the app, tap "Skann", take a photo; it uploads at once. Tap "Skann (1)".
   The app shows "Leser kvittering…" for 10–40 seconds, then the review screen with 23 lines, 21 mapped to known products and 2 new products created.
   The total matches the sum of the lines, so there is no warning.
   Tap "Ferdig".
2. Fixing a mapping.
   A line "TINE YT REST 330ML" was mapped to "Yoghurt" but is a protein drink.
   Tap the line, search "protein", pick "Proteindrikk", or type a new product name.
   Next time the same text appears it maps to "Proteindrikk" without asking the LLM.
3. Before shopping.
   Open the app on Friday, tap "Lag handleliste".
   The list contains 18 items such as "Lettmelk 1 l, 2 stk, kjøpes ca. hver 7. dag" and "Kaffe, sist for 20 dager siden".
   Remove two items, add "Bursdagskake", and check items off in the store.
4. Catching up.
   Pick six receipt photos from the library; they upload one after the other.
   Tap "Skann alle (6)" and open the receipts list, where the six move from "Lastet opp" through "Leser…" to "Klar".

## 3. Stack

Identical to the sibling `training-log` app, plus the pieces needed for images and the LLM.

| Layer | Choice | Version floor | Decision |
| --- | --- | --- | --- |
| Language | TypeScript, strict mode | 5.x | ADR-0002 |
| Runtime | Node.js | 22 LTS | ADR-0002 |
| Frontend | React, Vite, React Router, TanStack Query, Tailwind CSS | React 19, Vite 7, Router 7, Query 5, Tailwind 4 | ADR-0002 |
| Backend | Fastify with `@fastify/cookie`, `@fastify/static`, `@fastify/rate-limit`, `@fastify/multipart` | Fastify 5 | ADR-0002 |
| Images | `sharp` for validation, EXIF rotation, resize and JPEG re-encode | 0.33+ | ADR-0005 |
| LLM | Kimi via `openai` npm SDK against `https://api.moonshot.ai/v1`, model `kimi-k2.6`, JSON mode | openai 5.x | ADR-0003 |
| Validation | zod, schemas shared between client and server | 4.x | ADR-0013 |
| Database | SQLite via `better-sqlite3`, Drizzle ORM, `drizzle-kit` migrations | Drizzle 0.4x | ADR-0010 |
| Backup | Litestream replication to S3-compatible storage | 0.3.x | ADR-0011 |
| Logging | pino | 9.x | ADR-0012 |
| Tests | Vitest, React Testing Library, Fastify `inject`, fake LLM client, extraction eval set | Vitest 3 | ADR-0014 |
| Deploy | Docker image on Render (free plan) | — | ADR-0011 |

The versions in the table above are floors, not targets.
Pin exact versions in `package.json` and take the newest stable release on npm for every dependency, including a newer major, unless one of these stops it:

- a peer dependency range of another pinned package excludes it;
- it needs a different Node.js major than the Dockerfile uses, which is an ADR decision, so ask;
- `lint`, `typecheck`, `test` and `build` cannot pass with configuration changes only, or the upgrade contradicts a task or an ADR, so ask;
- the release is a pre-release, or its release notes call it unstable.

In those cases take the newest release that does work and record the reason in the commit body, one line per package.
Dependencies shared with the sibling app `training-log` are pinned to the same version in both repositories.
Confirmed with Ruben 2026-09-06, superseding the narrower reading of "version floor" used for T01–T03.

## 4. System overview

```
Phone browser (PWA)
   |  1. photo -> canvas downscale -> JPEG upload (multipart)
   v
Render web service (one Docker container)
   Fastify process
     /                 -> static SPA from dist/client
     /api/*            -> JSON API (auth cookie)
     POST /api/receipts -> store image + receipt(status=uploaded) -> 201
     POST /api/receipts/:id/scan -> status=pending -> 202 -> enqueue
     Job runner (in-process, one at a time)          ADR-0006
        2. extraction  --image + prompt-->  Kimi (api.moonshot.ai)   ADR-0003
        3. alias lookup (deterministic)                              ADR-0004
        4. matching    --unknown texts + known products--> Kimi (only if needed)
        5. save lines, products, aliases; status=done
     GET /api/receipts/:id  <- client polls every 2 s while pending/processing
     better-sqlite3 -> /data/receipt-scanner.db (WAL) incl. receipt images as BLOBs   ADR-0005
   Litestream process -> S3 bucket
```

The only external dependency at runtime is the Kimi API.
Everything else is one container and one SQLite file.

## 5. Repository layout

```
receipt-scanner/
  docs/
    architecture.md
    adr/
    tasks.md
  src/
    shared/
      schemas.ts             zod schemas for API payloads and inferred types
      dates.ts               civil date helpers: isIsoDate, diffDays, mondayOf, isoWeekKey, todayInOslo
      money.ts               formatOre(ore) -> "43,80 kr", parseNok(string|number) -> ore
      categories.ts          PRODUCT_CATEGORIES constant
      normalize.ts           normalizeText(), shared with the client for ProductPicker's exact-match check
    server/
      index.ts
      app.ts                 buildApp(options)
      config.ts
      db/
        schema.ts
        client.ts
        migrate.ts
      plugins/
        auth.ts
      lib/
        errors.ts
        images.ts            normaliseImage(buffer): validate, rotate, resize, encode JPEG, sha256
      llm/
        LlmClient.ts         interface + request/result types
        KimiClient.ts        OpenAI SDK implementation
        FakeLlmClient.ts     scripted test double
        extractReceipt.ts    buildExtractionRequest(), parseExtraction()
        matchProducts.ts     buildMatchRequest(), parseMatches()
        prompts/
          extractReceipt.prompt.ts   EXTRACT_PROMPT_VERSION and the system prompt text
          matchProducts.prompt.ts    MATCH_PROMPT_VERSION and the system prompt text
      domain/
        extraction.ts        applyExtraction(): decimals -> øre, warnings, line kinds
        matching.ts          matchLines(): alias lookup, LLM matching, product and alias upserts
        suggestions.ts       computeSuggestions(histories, today): pure function
        merge.ts             mergeProducts()
      jobs/
        receiptProcessor.ts  queue, processReceipt(), requeueUnfinished()
      routes/
        health.ts
        receipts.ts
        receiptLines.ts
        products.ts
        suggestions.ts
        shoppingLists.ts
    client/
      index.html
      main.tsx
      App.tsx
      api/
        client.ts
        queries.ts
      lib/
        downscaleImage.ts    File -> Blob (JPEG, max 2000 px long edge)
        format.ts
      pages/
        LoginPage.tsx
        ShoppingListPage.tsx   route /
        ScanPage.tsx           route /scan
        ReceiptsPage.tsx       route /receipts
        ReceiptPage.tsx        route /receipts/:id
        ProductsPage.tsx       route /products
        ProductPage.tsx        route /products/:id
      components/
        AppShell.tsx
        ReceiptStatusBadge.tsx
        ReceiptLineRow.tsx
        ProductPicker.tsx
        SuggestionCard.tsx
        ShoppingListItemRow.tsx
        Toast.tsx
      styles.css
      public/
        manifest.webmanifest
        icons/                 icon-192.png, icon-512.png, apple-touch-icon.png
  drizzle/
  eval/
    receipts/                real receipt photos and expected JSON (private repo)
    run.ts                   npm run eval:extraction
    results/                 one JSON per run, committed
  test/
    server/
    client/
    fixtures/
      llm/                   scripted Kimi responses as JSON
      images/                small test images
    helpers/
  Dockerfile, docker-compose.yml, litestream.yml, render.yaml, start.sh
  drizzle.config.ts, vite.config.ts, vitest.config.ts, tsconfig.json, tsconfig.server.json, eslint.config.js
  .env.example, package.json, README.md
```

Rules for the layout:

- `src/shared` has no Node or DOM imports.
- `src/server/domain/*` contains pure functions or functions that take a Drizzle `db` handle; it never imports Fastify.
- Only `src/server/llm/KimiClient.ts` imports the `openai` package.
  Everything else depends on the `LlmClient` interface.

## 6. Domain model

Money is integer øre (ADR-0007).
Dates are `YYYY-MM-DD` strings, timestamps are ISO 8601 UTC strings.

```sql
CREATE TABLE receipts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  status          TEXT NOT NULL CHECK (status IN ('uploaded','pending','processing','done','failed')),
  store_name      TEXT,
  purchased_at    TEXT,
  total_ore       INTEGER,
  currency        TEXT NOT NULL DEFAULT 'NOK',
  warnings_json   TEXT NOT NULL DEFAULT '[]',
  extraction_json TEXT,
  raw_response    TEXT,
  prompt_version  INTEGER,
  model           TEXT,
  error_message   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  possible_duplicate_of INTEGER REFERENCES receipts(id) ON DELETE SET NULL,
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE receipt_images (
  receipt_id  INTEGER PRIMARY KEY REFERENCES receipts(id) ON DELETE CASCADE,
  mime_type   TEXT NOT NULL,
  bytes       BLOB NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  sha256      TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  name_normalized TEXT NOT NULL UNIQUE,
  category        TEXT,
  suppressed      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE product_aliases (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  alias_normalized TEXT NOT NULL UNIQUE,
  product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source           TEXT NOT NULL CHECK (source IN ('llm','user')),
  created_at       TEXT NOT NULL
);

CREATE TABLE receipt_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id     INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  line_no        INTEGER NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('item','discount','deposit','other')),
  raw_text       TEXT NOT NULL,
  quantity       REAL NOT NULL DEFAULT 1,
  unit           TEXT CHECK (unit IS NULL OR unit IN ('stk','kg','l')),
  unit_price_ore INTEGER,
  total_ore      INTEGER NOT NULL,
  product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
  match_source   TEXT CHECK (match_source IS NULL OR match_source IN ('alias','llm','user')),
  created_at     TEXT NOT NULL
);
CREATE INDEX receipt_lines_receipt ON receipt_lines (receipt_id, line_no);
CREATE INDEX receipt_lines_product ON receipt_lines (product_id);

CREATE TABLE shopping_lists (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('open','done')),
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE shopping_list_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id       INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  quantity_text TEXT,
  source        TEXT NOT NULL CHECK (source IN ('suggested','manual')),
  reason        TEXT,
  checked       INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX shopping_list_items_list ON shopping_list_items (list_id, position);
```

Definitions:

- `normalizeText(s)`: Unicode NFKC, upper-case, every character that is not a Unicode letter or digit (`\p{L}`, `\p{N}`) becomes a space, whitespace collapsed, trimmed.
  Examples: `Tine® Lettmelk 1L` → `TINE LETTMELK 1L`, `Grünerløkka` → `GRÜNERLØKKA`, `Kaffe, filtermalt (250g)` → `KAFFE FILTERMALT 250G`.
  Used for `products.name_normalized` and `product_aliases.alias_normalized`.
- A product is the canonical thing the household buys ("Lettmelk 1 l"); an alias is a receipt text that maps to it ("TINE LETTMELK 1L").
  One alias maps to exactly one product; a product can have many aliases.
- `suppressed = 1` means "never suggest this product"; it still counts in history.
- Only lines with `kind = 'item'` are matched to products and counted in statistics.
  Discounts, deposits ("pant") and other lines are kept for the total check and for display.
- `warnings_json` is a JSON array of codes from the set `TOTAL_MISMATCH`, `MISSING_DATE`, `MISSING_STORE`, `FUTURE_DATE`, `UNMATCHED_LINES`, `MATCHING_FAILED`, `POSSIBLE_DUPLICATE`.
  `possible_duplicate_of` points at the receipt a `POSSIBLE_DUPLICATE` warning refers to.
- `other` is for lines that are printed on the receipt but are neither a purchase, a discount nor a deposit and that the model could not leave out; it is excluded from the total check and from statistics.
- `extraction_json` is the validated extraction result, `raw_response` the exact LLM text; both exist for debugging and for growing the eval set.
- At most one shopping list has `status = 'open'` at a time; enforced in code.
- `PRODUCT_CATEGORIES` is the fixed list: `Frukt og grønt`, `Meieri`, `Kjøtt og fisk`, `Brød og bakevarer`, `Tørrvarer`, `Frossen`, `Drikke`, `Snacks`, `Husholdning`, `Hygiene`, `Annet`.
- Migrations run with `foreign_keys` off and `PRAGMA foreign_key_check` after, because drizzle's SQLite table recreates would otherwise cascade-delete child rows.

## 7. Extraction pipeline

### 7.1 Upload

1. The client converts the chosen photo with `downscaleImage`: draw to a canvas with the long edge capped at 2000 px, export JPEG quality 0.85.
   This also converts HEIC from iPhones to JPEG, because the browser decodes it.
2. `POST /api/receipts` (multipart field `image`) accepts `image/jpeg`, `image/png`, `image/webp`, at most `MAX_UPLOAD_BYTES`.
3. The server runs `normaliseImage`: `sharp` reads metadata, rejects unknown formats with `400 VALIDATION_ERROR`, applies EXIF rotation, resizes so the long edge is at most 2000 px, encodes JPEG quality 85, and computes `sha256` of the result.
4. If a `receipt_images.sha256` already exists, reply `409 CONFLICT` with `details: { existingReceiptId }`.
5. Insert `receipts` (`status = 'uploaded'`) and `receipt_images` in one transaction, reply `201 { id }`; nothing is enqueued.

### 7.2 Job runner (ADR-0006)

- In-memory FIFO queue, concurrency 1, in the same process.
- `processReceipt(id)`: set `status = 'processing'`, `attempts += 1`; run extraction; run matching; set `status = 'done'`.
  Saving the extraction first deletes any lines left by an earlier attempt, in the same transaction as the insert, so a job that is retried after a crash replaces its data instead of duplicating it.
  Any thrown error sets `status = 'failed'`, stores a short Norwegian `error_message`, and logs the full error with `receiptId`.
- On startup, `requeueUnfinished()` enqueues every receipt with status `pending` or `processing`, so a crash mid-job is retried after restart; `uploaded` receipts wait for the user.
- `POST /api/receipts/:id/scan` sets `pending` and enqueues; allowed when `uploaded` or `failed`, else `409`.

### 7.3 Extraction call (ADR-0003)

Request to Kimi:

- `model`: `config.kimiModel` (default `kimi-k2.6`).
- `messages`: one `system` message with the prompt from `extractReceipt.prompt.ts`; one `user` message with two content parts, `{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } }` and a short text instruction.
- `response_format: { type: 'json_object' }`.
- `max_tokens: 6000`.
- `thinking: { type: config.kimiThinking }` where the default is `disabled`; this is a Moonshot-specific parameter passed through the SDK as an extra body field.
- No `temperature`; Kimi K2.6 uses a fixed temperature per thinking mode and rejects other values.
- Timeout `config.kimiTimeoutMs` (default 120 000), SDK retries 2.

Assumption to verify before any code depends on it: that `response_format: { type: 'json_object' }` is accepted on the same request as an `image_url` part.
The Moonshot documentation describes the two features separately.
T05 starts with one manual request that checks this.
If the combination is rejected, the fallback is to omit `response_format`, keep the JSON instructions in the prompt, and rely on `parseJsonObject`, which already strips code fences; ADR-0003 records the assumption.

The system prompt must:

- Explain Norwegian receipt conventions: decimal comma, `kr`, "PANT" deposit lines, "RABATT" or negative lines as discounts, weight-priced items printed as `1,135 kg x 24,90`, multi-quantity lines printed as `2 x 21,90`, store name in the header, date often at the bottom.
- Give one complete example output and describe every field.
- Require exactly one JSON object with the keys below and nothing else; arrays only inside the object.
- Require `text` to be the item text as printed, not a cleaned-up name.
- Require that subtotal, total, VAT, payment, change, card and loyalty-programme lines are left out of `lines`; the receipt total goes only in `total`.

Expected output, validated with zod after `JSON.parse`, numbers in NOK with decimals, strings with a decimal comma accepted through a preprocess step:

```json
{
  "storeName": "REMA 1000 Grünerløkka",
  "purchasedAt": "2026-09-03",
  "total": 458.90,
  "lines": [
    { "text": "TINE LETTMELK 1L", "kind": "item", "quantity": 2, "unit": "stk", "unitPrice": 21.90, "totalPrice": 43.80 },
    { "text": "BANAN", "kind": "item", "quantity": 1.135, "unit": "kg", "unitPrice": 24.90, "totalPrice": 28.26 },
    { "text": "PANT", "kind": "deposit", "quantity": 4, "unit": "stk", "unitPrice": 3.00, "totalPrice": 12.00 },
    { "text": "RABATT LETTMELK", "kind": "discount", "quantity": 1, "unit": null, "unitPrice": null, "totalPrice": -5.00 }
  ]
}
```

Constraints after normalisation: `storeName` max 80 chars or null; `purchasedAt` ISO date or null; `total` number or null; `lines` at most 200; `text` 1–120 chars; `kind` one of the four values; `quantity` positive, default 1; `unit` `stk`, `kg`, `l` or null; `unitPrice` number or null; `totalPrice` number.

The schema is lenient on purpose, so one odd value never fails a whole receipt.
A zod `preprocess` step normalises before validation:

- `kind` outside the four values becomes `other`.
- `quantity` missing, non-numeric or not positive becomes `1`.
- `unit` `g` and `hg` convert the quantity to kilograms (`÷ 1000`, `÷ 10`) with unit `kg`; `ml`, `cl` and `dl` convert to litres (`÷ 1000`, `÷ 100`, `÷ 10`) with unit `l`; `stk`, `kg` and `l` are kept; any other value becomes `unit = null` and `quantity = 1`.
- Amounts accept numbers or decimal-comma strings through `parseNok`.

Only a missing or empty `text`, a `totalPrice` that is not a number after preprocessing, or a `lines` value that is not an array fail validation.

Failure handling:

- `finish_reason === 'length'` → error "Kvitteringen var for lang til å leses"; the job fails.
- JSON parse or zod failure → error "Kunne ikke tolke svaret fra lesingen"; the raw text is stored in `raw_response`; the job fails.
- HTTP 429 or 5xx after SDK retries → error "Lesetjenesten er utilgjengelig, prøv igjen senere"; the job fails.

### 7.4 Applying the extraction (`domain/extraction.ts`)

Pure function `applyExtraction(result, scanDate)` returning receipt fields, lines and warnings:

- Convert every NOK amount to øre with `Math.round(x * 100)`.
- `purchasedAt` null → use `scanDate`, add `MISSING_DATE`; later than `scanDate` → keep, add `FUTURE_DATE`.
- `storeName` null → add `MISSING_STORE`.
- `lineSum` is the sum of `totalPrice` over lines with `kind` `item`, `discount` or `deposit`; `other` lines are excluded.
- `total` null → set `total_ore` to `lineSum`, add `TOTAL_MISMATCH`.
- `|lineSum − total| > 100 øre` → add `TOTAL_MISMATCH`.
- No lines with `kind = 'item'` → throw; the job fails with "Fant ingen varelinjer".
- `line_no` is the 1-based index in the returned order.

After `applyExtraction`, the job runs the duplicate check `findPossibleDuplicate(db, receiptId, storeName, purchasedAt, totalOre)`, which needs the database and therefore lives outside the pure function.
It looks for another receipt with `status = 'done'`, the same `purchased_at`, the same `total_ore`, and the same `normalizeText(store_name)` (two `null` stores also count as equal).
A hit sets `possible_duplicate_of` and adds `POSSIBLE_DUPLICATE`.
This catches a receipt photographed twice with two different photos, which the `sha256` check in 7.1 cannot see.
A long receipt split over two photos is not detected; the halves have different totals and stay separate receipts.
`PATCH /api/receipts/:id` re-runs the same check when store, date or total change.

### 7.5 Matching (`domain/matching.ts`, ADR-0004)

1. For every `item` line compute `key = normalizeText(raw_text)` and look up `product_aliases`.
   Hit → set `product_id`, `match_source = 'alias'`.
2. Collect distinct unmatched keys.
   If none, matching is complete.
3. Otherwise the distinct unmatched texts are split into batches of at most 20, one Kimi call per batch with the `matchProducts` prompt: input is that batch's texts and the list of known product names (non-suppressed, ordered by purchase count descending, at most 1 000), plus `PRODUCT_CATEGORIES`; `maxTokens` is 150 per text in the batch plus 200.
   Output, validated with zod:

```json
{
  "matches": [
    { "text": "TINE LETTMELK 1L", "existingProduct": "Lettmelk 1 l", "newProductName": "Lettmelk 1 l", "category": "Meieri" },
    { "text": "GROVBRØD 750G", "existingProduct": null, "newProductName": "Grovbrød", "category": "Brød og bakevarer" }
  ]
}
```

4. Apply each match in a transaction:
   - `existingProduct` non-null and `normalizeText(existingProduct)` equals a product `name_normalized` → link that product.
   - Otherwise `normalizeText(newProductName)` equals an existing product → link it.
   - Otherwise create the product with `name = newProductName.trim()` and the category (must be in `PRODUCT_CATEGORIES`, else `Annet`).
   - Insert the alias `key → product_id` with `source = 'llm'`.
   - Set `match_source = 'llm'` on the lines.
5. Texts the LLM did not return keep `product_id = null`; add `UNMATCHED_LINES`.
6. An answer cut off at the token budget (`finishReason: 'length'`) counts as a failed batch, the same as a call that errors outright: its texts stay unmatched, the other batches' matches are kept, and the receipt still becomes `done` with `MATCHING_FAILED`; `POST /api/receipts/:id/rematch` re-runs steps 1–5 for lines with `product_id IS NULL`.

Naming guidance in the prompt: Norwegian, singular, generic but specific enough to be useful on a shopping list ("Lettmelk 1 l", "Banan", "Grovbrød", "Kaffe filtermalt 250 g"), brand only when it distinguishes what to buy.

### 7.6 User corrections

- `PATCH /api/receipt-lines/:id` with `{ productId }` or `{ newProductName, category? }` sets `product_id`, `match_source = 'user'`, and upserts the alias `normalizeText(raw_text) → product_id` with `source = 'user'`, replacing any LLM alias.
- `POST /api/products/:id/merge { intoProductId }` moves all lines and aliases from the source to the target, adds the source name as an alias of the target, and deletes the source.
- `PATCH /api/products/:id` renames (uniqueness on `name_normalized`), sets category, or toggles `suppressed`.

## 8. Suggestion engine (`domain/suggestions.ts`, ADR-0008)

Pure function `computeSuggestions(histories, today)`.

Input per product: `{ productId, name, category, suppressed, purchases: { date, quantity, unit }[] }` where purchases are aggregated per receipt date (quantities summed) from `receipt_lines` with `kind = 'item'` joined to receipts with `status = 'done'`.

Algorithm, evaluated per product:

1. Skip if `suppressed`.
2. `weeks` = distinct `isoWeekKey(date)` over the purchase dates, ascending; `n = weeks.length`; skip if `n < 2`.
   Two purchases in the same week count as one purchase week, so a product bought on two consecutive days once is not a pattern.
3. `daysSinceLast = diffDays(lastPurchaseDate, today)`; skip if `daysSinceLast <= 3` (bought on this trip).
4. `medianGap = 7 × median(gaps in whole weeks between consecutive purchase weeks)`, so the smallest possible gap is 7 days.
5. Skip if `daysSinceLast > max(60, 3 × medianGap)` (stale product).
6. `dueIn = medianGap − daysSinceLast`; `dueRule = dueIn <= 3`.
7. `weeksBought` = number of distinct `isoWeekKey(date)` among dates within the last 84 days; `freqRule = weeksBought / 12 >= 0.5`.
8. Skip unless `dueRule || freqRule`.
9. `score = daysSinceLast / medianGap`.
10. `reason` = when `dueRule`: `Kjøpes ca. hver {medianGap}. dag, sist for {daysSinceLast} dager siden`; otherwise `Kjøpt {weeksBought} av de siste 12 ukene`.
11. `quantityText`: median quantity over purchases; unit `kg` → one decimal plus ` kg`; otherwise `max(1, round(median))` plus ` stk`.

Output sorted by `score` descending, then `name`.
Each suggestion is `{ productId, name, category, reason, quantityText, score }`.

Worked example with `today = 2026-09-04`: milk bought 08-07, 08-14, 08-21, 08-28 → `medianGap 7`, `daysSinceLast 7`, `dueIn 0` → suggested with score 1.0.
Coffee bought 07-24, 08-14 → `medianGap 21`, `daysSinceLast 21`, `dueIn 0` → suggested.
Flour bought 06-01, 06-15 → `daysSinceLast 81 > max(60, 42)` → skipped as stale.
Bananas bought 09-02 and 08-26 → `daysSinceLast 2` → skipped, bought this trip.
Chips bought 08-31 and 09-01 → one purchase week → `n = 1` → skipped.

## 9. API contract

All endpoints under `/api`, JSON, camelCase.
Auth cookie required except `POST /api/auth/login` and `GET /api/health` (ADR-0009).
Error body is `{ error: { code, message, details?, requestId } }` with codes `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `INTERNAL` (ADR-0012).

### Shapes

```ts
type ReceiptStatus = 'uploaded' | 'pending' | 'processing' | 'done' | 'failed';

type ReceiptSummary = {
  id: number; status: ReceiptStatus; storeName: string | null; purchasedAt: string | null;
  totalOre: number | null; lineCount: number; warnings: string[]; errorMessage: string | null;
  possibleDuplicateOf: number | null; reviewedAt: string | null; createdAt: string;
};

type ReceiptLine = {
  id: number; lineNo: number; kind: 'item' | 'discount' | 'deposit' | 'other'; rawText: string;
  quantity: number; unit: 'stk' | 'kg' | 'l' | null; unitPriceOre: number | null; totalOre: number;
  product: { id: number; name: string; category: string | null } | null;
  matchSource: 'alias' | 'llm' | 'user' | null;
};

type ReceiptDetail = ReceiptSummary & { lines: ReceiptLine[]; imageUrl: string };

type Product = {
  id: number; name: string; category: string | null; suppressed: boolean;
  timesBought: number; lastBought: string | null; medianIntervalDays: number | null;
};

type ProductDetail = Product & {
  aliases: { id: number; alias: string; source: 'llm' | 'user' }[];
  purchases: { receiptId: number; date: string; storeName: string | null; quantity: number; unit: string | null; totalOre: number }[];
};

type Suggestion = { productId: number; name: string; category: string | null; reason: string; quantityText: string; score: number };

type ShoppingList = {
  id: number; weekStart: string; status: 'open' | 'done'; createdAt: string; completedAt: string | null;
  items: { id: number; productId: number | null; name: string; quantityText: string | null;
           source: 'suggested' | 'manual'; reason: string | null; checked: boolean; position: number }[];
};
```

### Endpoints

| Method and path | Body | Response | Notes |
| --- | --- | --- | --- |
| `GET /api/health` | — | `200 { status: 'ok', version, queueLength }` | No auth. Never calls Kimi. |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | as in ADR-0009 | | Cookie `kvitteringer_auth`. |
| `POST /api/receipts` | multipart `image` | `201 { id }` | `400` bad image, `413 PAYLOAD_TOO_LARGE`, `409` duplicate with `details.existingReceiptId`. |
| `GET /api/receipts?limit=50&before=<id>` | — | `200 ReceiptSummary[]` | Newest first, cursor pagination on id. |
| `GET /api/receipts/:id` | — | `200 ReceiptDetail` | Client polls this every 2 s while `pending` or `processing`. |
| `GET /api/receipts/:id/image` | — | `200 image/jpeg` | `Cache-Control: private, max-age=86400`. |
| `PATCH /api/receipts/:id` | `{ storeName?, purchasedAt?, totalOre?, reviewed? }` | `200 ReceiptDetail` | `reviewed: true` sets `reviewedAt`. Recomputes `TOTAL_MISMATCH` and `POSSIBLE_DUPLICATE`; when `storeName` is patched, `MISSING_STORE` is set only if it is null; when `purchasedAt` is patched, `MISSING_DATE` is removed and `FUTURE_DATE` is set only if the date is after `todayInOslo()`. Only when `done`. |
| `POST /api/receipts/:id/scan` | — | `202 ReceiptSummary` | Only when `uploaded` or `failed`, else `409`. |
| `POST /api/receipts/:id/rematch` | — | `200 ReceiptDetail` | Runs matching for unmatched lines synchronously; may call Kimi. |
| `DELETE /api/receipts/:id` | — | `204` | Cascades lines and image. |
| `PATCH /api/receipt-lines/:id` | `{ productId }` or `{ newProductName, category? }` | `200 ReceiptLine` | Upserts a user alias. Removes `UNMATCHED_LINES` from the receipt when no item line has `product_id IS NULL`; `MATCHING_FAILED` is left alone. |
| `GET /api/products?q=&includeSuppressed=` | — | `200 Product[]` | `q` filters on `name_normalized` contains `normalizeText(q)`. Ordered by `timesBought` desc, then name. |
| `GET /api/products/:id` | — | `200 ProductDetail` | |
| `POST /api/products` | `{ name, category? }` | `201 Product` | `409` on duplicate normalized name. |
| `PATCH /api/products/:id` | `{ name?, category?, suppressed? }` | `200 Product` | |
| `POST /api/products/:id/merge` | `{ intoProductId }` | `200 Product` | Returns the target. `400` when ids are equal. |
| `DELETE /api/product-aliases/:id` | — | `204` | Lines keep their product; only future matching changes. |
| `GET /api/suggestions` | — | `200 Suggestion[]` | Computed on demand; no caching. |
| `GET /api/shopping-lists/current` | — | `200 ShoppingList` | `404` when no open list. |
| `POST /api/shopping-lists` | — | `201 ShoppingList` or `200` existing open list | Populated from suggestions. `weekStart = mondayOf(today)`. |
| `POST /api/shopping-lists/:id/items` | `{ name, productId?, quantityText? }` | `201 item` | `source = 'manual'`, appended last. |
| `PATCH /api/shopping-list-items/:id` | `{ checked?, name?, quantityText?, position? }` | `200 item` | |
| `DELETE /api/shopping-list-items/:id` | — | `204` | |
| `POST /api/shopping-lists/:id/complete` | — | `200 ShoppingList` | Sets `done` and `completedAt`. |
| `GET /api/shopping-lists?limit=20` | — | `200 ShoppingList[]` without items | History, newest first. Phase 2. |
| `GET /api/stats/summary?months=6` | — | `200 { months: { month, totalOre, receipts }[], topProducts: Product[] }` | Phase 2 (T20). |

## 10. Frontend

### Routes

| Route | Page | Content |
| --- | --- | --- |
| `/login` | LoginPage | Password field. |
| `/` | ShoppingListPage | The open list with check-off, add item, remove item, "Ferdig handlet"; when there is no open list, a preview of suggestions and a "Lag handleliste" button. |
| `/scan` | ScanPage | "Ta bilde" (`<input type="file" accept="image/*" capture="environment">`, one photo) and "Velg fra bilder" (same input without `capture`, `multiple`). Every selected file is downscaled and uploaded at once, one after the other in selection order, in a list with per-file state: "Laster opp … 45 %", "Lastet opp", "Allerede skannet" with a link to the existing receipt, or "Feilet: {message}". Below the list, "Skann (1)" or "Skann alle (n)" for every receipt with status `uploaded`; it calls scan for each and navigates to `/receipts/:id` when n is 1, else to `/receipts`. |
| `/receipts` | ReceiptsPage | List with store, date, total, status badge and warning count; tap opens the receipt. "Skann" on each `uploaded` row and "Skann alle (n)" above the list. |
| `/receipts/:id` | ReceiptPage | While `uploaded`: image thumbnail, "Skann" and "Slett kvittering". While `pending`/`processing`: image thumbnail and "Leser kvittering…" with polling. When `failed`: error and "Prøv igjen", which calls scan. When `done`: editable header (store, date, total), warning chips (the `POSSIBLE_DUPLICATE` chip links to the other receipt), lines with product picker per item line, "Ferdig" that sets `reviewed`. |
| `/products` | ProductsPage | Search field, list with times bought, last bought, interval; toggle to show suppressed. |
| `/products/:id` | ProductPage | Rename, category select, "Ikke foreslå" toggle, merge into another product, aliases with delete, purchase history. |

Bottom navigation: Handleliste (`/`), Skann (`/scan`), Kvitteringer (`/receipts`), Varer (`/products`).

### Behaviour rules

- UI text in Norwegian bokmål; code in English.
- Amounts render with `formatOre`: `43,80 kr`; negative amounts with a leading minus.
- `ProductPicker` is a combobox that searches `/api/products?q=` with 200 ms debounce and offers "Opprett «…»" when there is no exact match.
- Receipt polling uses TanStack Query `refetchInterval` of 2 000 ms only while status is `pending` or `processing`, and stops otherwise.
- Checking an item on the shopping list is optimistic; failure reverts and shows a toast.
- Upload shows progress with `XMLHttpRequest` upload events or a simple indeterminate bar; either is acceptable.
- Uploads run one at a time in selection order; a `409` on one file does not stop the others.
- `ReceiptStatusBadge` shows `uploaded` as "Lastet opp".
- Every mutation invalidates the affected queries: receipts, receipt detail, products, suggestions, current list.
- A `401` clears the query cache and navigates to `/login`.
- Layout is mobile-first at 360 px, tap targets at least 44 px, safe-area padding for the bottom bar.

## 11. Cross-cutting rules

### Configuration

`src/server/config.ts` parses `process.env` with zod and refuses to start when invalid.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | |
| `PORT` | no | `3000` | Dockerfile sets `8080`. |
| `HOST` | no | `0.0.0.0` | |
| `DATABASE_PATH` | no | `./data/receipt-scanner.db` | Dockerfile sets `/data/receipt-scanner.db`. |
| `APP_PASSWORD` | yes | — | Min 8 chars. |
| `SESSION_SECRET` | yes | — | Min 32 chars. |
| `MOONSHOT_API_KEY` | yes | — | Kimi API key. |
| `KIMI_MODEL` | no | `kimi-k2.6` | Must support image input and JSON mode. |
| `KIMI_BASE_URL` | no | `https://api.moonshot.ai/v1` | |
| `KIMI_THINKING` | no | `disabled` | `enabled` or `disabled`. |
| `KIMI_TIMEOUT_MS` | no | `120000` | |
| `MAX_UPLOAD_BYTES` | no | `10485760` | 10 MB. |
| `LOG_LEVEL` | no | `info` | |
| `TZ` | no | `Europe/Oslo` | The server computes `today` with this zone. |
| `LITESTREAM_*` | no | — | Used by `start.sh` and `litestream.yml`. |

### Authentication (ADR-0009)

Same scheme as the sibling app: shared password, `timingSafeEqual`, cookie `kvitteringer_auth` = `hex(HMAC-SHA256(SESSION_SECRET, "kvitteringer-v1"))`, `HttpOnly`, `SameSite=Lax`, one year, `Secure` in production, guard on `/api/*` except login and health, login rate limit 5 per minute per IP.
Receipt images are served under `/api`, so they are protected.
Fastify is created with `trustProxy: true` in production, so `request.ip`, and therefore the login rate limit, uses the real client address behind the Render proxy instead of the proxy address shared by everyone.
The guard runs before routing, so an unauthenticated request to an unknown `/api` path gets `401`, not `404`.

### Logging and errors (ADR-0012)

- pino through Fastify, `console.*` forbidden, redaction of cookie and authorization headers.
- Every LLM call logs one line at `info` with `purpose`, `receiptId`, `model`, `promptVersion`, `promptTokens`, `completionTokens`, `durationMs`, `finishReason`.
  Never log the image or the full prompt at `info`; the raw response is stored in the database instead.
- Job failures log at `error` with `err`, `receiptId`, `attempts`.
- Error bodies follow the one shape; `500` never leaks stack traces.

### Money, dates, time zone (ADR-0007)

- Amounts are integer øre everywhere in the server and the API; the client formats them.
- Dates are civil `YYYY-MM-DD` strings.
  `today` on the server is computed with `Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' })`, wrapped in `todayInOslo(now?)` in `src/shared/dates.ts`.
- Week keys use ISO weeks with Monday start; `mondayOf(date)` and `isoWeekKey(date)` live in `src/shared/dates.ts` and are unit tested around year boundaries.

### Privacy

Receipt images and extracted text are sent to Moonshot AI for processing (ADR-0003).
Receipts can contain store location, loyalty card ids and the last digits of a payment card.
This is accepted for a personal household tool; do not scan documents with full card numbers or national ids.
The database, including images, is replicated to the household S3 bucket only.

## 12. Testing strategy (ADR-0014)

| Level | Tool | What |
| --- | --- | --- |
| Pure domain | Vitest | `normalizeText`, `parseNok`, `applyExtraction` (warnings, øre conversion), `computeSuggestions` (every rule with fixtures and the worked example), dates and ISO weeks. |
| LLM parsing | Vitest | `parseExtraction` and `parseMatches` against fixture responses, including malformed JSON, comma decimals, missing fields, truncated output. |
| Matching | Vitest + in-memory DB + `FakeLlmClient` | Alias hit path, LLM path creating products and aliases, user correction overriding an alias, merge, batching (batch sizes, `maxTokens`, a `finishReason: 'length'` batch failing without losing the others). |
| Job runner | Vitest + in-memory DB + `FakeLlmClient` | Status transitions, failure messages, `requeueUnfinished`, scan. |
| API | Vitest + `app.inject()` | Every endpoint, including multipart upload with a fixture image, duplicate detection, auth. |
| Client | Vitest + RTL | `downscaleImage` (mock canvas), `ProductPicker`, `ReceiptPage` states, `ShoppingListPage` suggestions preview, check-off (optimistic, reverts on failure), add item, complete, ScanPage multi-upload, `ReceiptsPage` rendering and pagination, `ProductsPage` search/filter, `ProductPage` rename/suppress/merge/alias delete. |
| Extraction eval | `npm run eval:extraction`, real Kimi | Real receipt photos under `eval/receipts/` with expected JSON; metrics per receipt and aggregate written to `eval/results/`. Run before merging any prompt or model change. Costs real money; never runs in CI. |

Unit and API tests never call the network; `KimiClient` is only exercised by the eval script.
Any wrong extraction or wrong match seen in real use is added to the eval set or to the fixtures before it is fixed.

## 13. Build, run, deploy

Scripts are the same as the sibling app plus `npm run eval:extraction` (`tsx eval/run.ts`).
Docker, `start.sh`, `litestream.yml` and `render.yaml` follow ADR-0011 with the database name `receipt-scanner.db`.
`sharp` needs its prebuilt binary for `linuxmusl` in the Alpine image; `npm ci` in the final stage handles it, and the Dockerfile must not copy `node_modules` from the build stage across architectures.

## 14. Non-functional requirements

- Upload to `202` under 3 seconds on mobile data for a 2000 px JPEG.
- Extraction end to end typically 10–40 seconds; the UI must stay responsive and explain what is happening.
- Cost per receipt with `kimi-k2.6` at published prices (0.95 USD per million input tokens, 4.00 USD per million output tokens) is roughly 0.1–0.2 NOK; one household year is well under 20 NOK.
- Database growth about 20–30 MB per year including images; Litestream handles this comfortably.
- Suggestions compute in under 200 ms for 500 products and 5 000 lines.

## 15. Future work

- Refresh suggestions into an existing open list without recreating it.
- Spend per month and per category (T20).
- Compare the shopping list against the next receipt to learn forgotten items.
- Export products and history as CSV.
- Optional integration with the `shopper` app for prices.
