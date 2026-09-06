import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type OpenedDatabase } from '../../../src/server/db/client.ts';
import { runMigrations } from '../../../src/server/db/migrate.ts';
import { productAliases, products, receiptLines, receipts } from '../../../src/server/db/schema.ts';
import { matchLines } from '../../../src/server/domain/matching.ts';
import { FakeLlmClient } from '../../../src/server/llm/FakeLlmClient.ts';
import type {
  JsonCompletionRequest,
  JsonCompletionResult,
} from '../../../src/server/llm/LlmClient.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', '..', 'fixtures', 'llm');
const NOW = '2026-09-03T12:00:00.000Z';

async function readFixture(name: string): Promise<string> {
  return readFile(path.join(fixturesDir, name), 'utf-8');
}

function fakeCompletion(text: string): JsonCompletionResult {
  return {
    text,
    finishReason: 'stop',
    model: 'kimi-k2.6',
    usage: { promptTokens: 10, completionTokens: 5 },
    durationMs: 5,
  };
}

function truncatedCompletion(): JsonCompletionResult {
  return {
    text: '',
    finishReason: 'length',
    model: 'kimi-k2.6',
    usage: { promptTokens: 10, completionTokens: 3200 },
    durationMs: 5,
  };
}

/** Matches every text in the request's batch to a new product named after itself, so a
 * multi-batch test can assert per-batch effects without scripting each batch's content by hand. */
function matchesEchoingBatch(request: JsonCompletionRequest): JsonCompletionResult {
  const texts = [...request.userText.matchAll(/^- (ITEM \d+)$/gm)].map((match) => match[1]!);
  return fakeCompletion(
    JSON.stringify({
      matches: texts.map((text) => ({
        text,
        existingProduct: null,
        newProductName: text,
        category: 'Annet',
      })),
    }),
  );
}

function stubLogger(): FastifyBaseLogger {
  return { error: vi.fn() } as unknown as FastifyBaseLogger;
}

let opened: OpenedDatabase;

function createDb(): OpenedDatabase {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function insertReceipt(): number {
  return opened.db
    .insert(receipts)
    .values({ status: 'processing', createdAt: NOW, updatedAt: NOW })
    .returning()
    .get().id;
}

function insertLine(
  receiptId: number,
  lineNo: number,
  rawText: string,
  overrides: Partial<typeof receiptLines.$inferInsert> = {},
): number {
  return opened.db
    .insert(receiptLines)
    .values({
      receiptId,
      lineNo,
      kind: 'item',
      rawText,
      totalOre: 100,
      createdAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertProduct(
  name: string,
  overrides: Partial<typeof products.$inferInsert> = {},
): number {
  return opened.db
    .insert(products)
    .values({
      name,
      nameNormalized: name.toUpperCase(),
      category: 'Meieri',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertAlias(
  aliasNormalized: string,
  productId: number,
  source: 'llm' | 'user' = 'user',
): void {
  opened.db
    .insert(productAliases)
    .values({ aliasNormalized, productId, source, createdAt: NOW })
    .run();
}

function getLine(id: number) {
  return opened.db.select().from(receiptLines).where(eq(receiptLines.id, id)).get();
}

afterEach(() => {
  opened.sqlite.close();
});

describe('matchLines', () => {
  it('links a line with an existing alias without any LLM request', async () => {
    opened = createDb();
    const productId = insertProduct('Lettmelk 1 l');
    insertAlias('TINE LETTMELK 1L', productId);
    const receiptId = insertReceipt();
    const lineId = insertLine(receiptId, 1, 'TINE LETTMELK 1L');
    const llm = new FakeLlmClient([]);

    const result = await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });

    expect(llm.requests).toHaveLength(0);
    expect(result).toEqual({ matchedByAlias: 1, matchedByLlm: 0, unmatched: [], warnings: [] });
    expect(getLine(lineId)).toMatchObject({ productId, matchSource: 'alias' });
  });

  it('sends exactly one LLM request containing both unknown texts and the known product names', async () => {
    opened = createDb();
    insertProduct('Lettmelk 1 l');
    const receiptId = insertReceipt();
    insertLine(receiptId, 1, 'TINE LETTMELK 1L');
    insertLine(receiptId, 2, 'GROVBRØD 750G');
    const llm = new FakeLlmClient([fakeCompletion(await readFixture('match-basic.json'))]);

    await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });

    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]?.userText).toContain('TINE LETTMELK 1L');
    expect(llm.requests[0]?.userText).toContain('GROVBRØD 750G');
    expect(llm.requests[0]?.userText).toContain('Lettmelk 1 l');
  });

  it('links existingProduct to the existing product and creates an llm alias', async () => {
    opened = createDb();
    const productId = insertProduct('Lettmelk 1 l');
    const receiptId = insertReceipt();
    const lineId = insertLine(receiptId, 1, 'TINE LETTMELK 1L');
    insertLine(receiptId, 2, 'GROVBRØD 750G');
    const llm = new FakeLlmClient([fakeCompletion(await readFixture('match-basic.json'))]);

    await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });

    expect(getLine(lineId)).toMatchObject({ productId, matchSource: 'llm' });
    const alias = opened.db
      .select()
      .from(productAliases)
      .where(eq(productAliases.aliasNormalized, 'TINE LETTMELK 1L'))
      .get();
    expect(alias).toMatchObject({ productId, source: 'llm' });
  });

  it('creates a new product with the given category and an alias when existingProduct is null', async () => {
    opened = createDb();
    insertProduct('Lettmelk 1 l');
    const receiptId = insertReceipt();
    insertLine(receiptId, 1, 'TINE LETTMELK 1L');
    const breadLineId = insertLine(receiptId, 2, 'GROVBRØD 750G');
    const llm = new FakeLlmClient([fakeCompletion(await readFixture('match-basic.json'))]);

    await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });

    const line = getLine(breadLineId);
    expect(line?.matchSource).toBe('llm');
    const created = opened.db
      .select()
      .from(products)
      .where(eq(products.id, line!.productId!))
      .get();
    expect(created).toMatchObject({ name: 'Grovbrød', category: 'Brød og bakevarer' });
    const alias = opened.db
      .select()
      .from(productAliases)
      .where(eq(productAliases.aliasNormalized, 'GROVBRØD 750G'))
      .get();
    expect(alias?.source).toBe('llm');
  });

  it('links to an existing product when newProductName normalises to it, instead of duplicating', async () => {
    opened = createDb();
    const productId = insertProduct('Grovbrød', { nameNormalized: 'GROVBRØD' });
    const receiptId = insertReceipt();
    const lineId = insertLine(receiptId, 1, 'LANDBRØD GROVBRØD 750G');
    const llm = new FakeLlmClient([
      fakeCompletion(
        JSON.stringify({
          matches: [
            {
              text: 'LANDBRØD GROVBRØD 750G',
              existingProduct: null,
              newProductName: 'Grovbrød',
              category: 'Brød og bakevarer',
            },
          ],
        }),
      ),
    ]);

    await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });

    expect(getLine(lineId)).toMatchObject({ productId, matchSource: 'llm' });
    expect(opened.db.select().from(products).all()).toHaveLength(1);
  });

  it('leaves a text missing from the response unmatched and adds UNMATCHED_LINES', async () => {
    opened = createDb();
    const receiptId = insertReceipt();
    insertLine(receiptId, 1, 'TINE LETTMELK 1L');
    const mysteryId = insertLine(receiptId, 2, 'MYSTERY ITEM');
    const llm = new FakeLlmClient([fakeCompletion(await readFixture('match-partial.json'))]);

    const result = await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });

    expect(result.warnings).toContain('UNMATCHED_LINES');
    expect(result.unmatched).toEqual(['MYSTERY ITEM']);
    expect(getLine(mysteryId)).toMatchObject({ productId: null, matchSource: null });
  });

  it('leaves a line unmatched instead of creating a product named "" when newProductName is blank', async () => {
    opened = createDb();
    const receiptId = insertReceipt();
    const lineId = insertLine(receiptId, 1, 'TINE LETTMELK 1L');
    const llm = new FakeLlmClient([
      fakeCompletion(
        JSON.stringify({
          matches: [
            {
              text: 'TINE LETTMELK 1L',
              existingProduct: null,
              newProductName: '  ',
              category: 'Meieri',
            },
          ],
        }),
      ),
    ]);

    const result = await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });

    expect(result.warnings).toContain('UNMATCHED_LINES');
    expect(getLine(lineId)).toMatchObject({ productId: null, matchSource: null });
    expect(opened.db.select().from(products).all()).toHaveLength(0);
  });

  it('leaves lines unmatched with MATCHING_FAILED when the LLM call fails, and rematch (matchLines again) fixes it once the fake succeeds', async () => {
    opened = createDb();
    const receiptId = insertReceipt();
    const lineId = insertLine(receiptId, 1, 'TINE LETTMELK 1L');
    const llm = new FakeLlmClient([
      () => {
        throw new Error('down');
      },
      fakeCompletion(
        JSON.stringify({
          matches: [
            {
              text: 'TINE LETTMELK 1L',
              existingProduct: null,
              newProductName: 'Lettmelk 1 l',
              category: 'Meieri',
            },
          ],
        }),
      ),
    ]);

    const failed = await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });
    expect(failed.warnings).toEqual(['MATCHING_FAILED']);
    expect(getLine(lineId)?.productId).toBeNull();

    const retried = await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });
    expect(retried.warnings).toEqual([]);
    expect(getLine(lineId)?.matchSource).toBe('llm');
  });

  it('never sends discount or deposit lines to the LLM', async () => {
    opened = createDb();
    const receiptId = insertReceipt();
    insertLine(receiptId, 1, 'RABATT', { kind: 'discount', totalOre: -100 });
    insertLine(receiptId, 2, 'PANT', { kind: 'deposit' });
    const itemLineId = insertLine(receiptId, 3, 'TINE LETTMELK 1L');
    const llm = new FakeLlmClient([
      fakeCompletion(
        JSON.stringify({
          matches: [
            {
              text: 'TINE LETTMELK 1L',
              existingProduct: null,
              newProductName: 'Lettmelk 1 l',
              category: 'Meieri',
            },
          ],
        }),
      ),
    ]);

    await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });

    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]?.userText).not.toContain('RABATT');
    expect(llm.requests[0]?.userText).not.toContain('PANT');
    expect(getLine(itemLineId)?.matchSource).toBe('llm');
  });

  it('does nothing and makes no request when there are no unmatched item lines', async () => {
    opened = createDb();
    const receiptId = insertReceipt();
    insertLine(receiptId, 1, 'RABATT', { kind: 'discount', totalOre: -100 });
    const llm = new FakeLlmClient([]);

    const result = await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });

    expect(llm.requests).toHaveLength(0);
    expect(result).toEqual({ matchedByAlias: 0, matchedByLlm: 0, unmatched: [], warnings: [] });
  });

  it('splits 45 distinct unmatched texts into batches of 20, 20 and 5 with a matching token budget (T26)', async () => {
    opened = createDb();
    const receiptId = insertReceipt();
    for (let i = 1; i <= 45; i += 1) {
      insertLine(receiptId, i, `ITEM ${i}`);
    }
    const llm = new FakeLlmClient([matchesEchoingBatch, matchesEchoingBatch, matchesEchoingBatch]);

    await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger: stubLogger(),
      receiptId,
    });

    expect(llm.requests).toHaveLength(3);
    expect(llm.requests.map((request) => request.maxTokens)).toEqual([3200, 3200, 950]);
    const batchSizes = llm.requests.map(
      (request) => (request.userText.match(/^- ITEM \d+$/gm) ?? []).length,
    );
    expect(batchSizes).toEqual([20, 20, 5]);
  });

  it('keeps matches from the batches that succeed and sets MATCHING_FAILED, with finishReason and batchSize logged, when one batch is truncated (T26)', async () => {
    opened = createDb();
    const receiptId = insertReceipt();
    const lineIds = Array.from({ length: 45 }, (_, index) =>
      insertLine(receiptId, index + 1, `ITEM ${index + 1}`),
    );
    const errorSpy = vi.fn();
    const logger = { error: errorSpy } as unknown as FastifyBaseLogger;
    const llm = new FakeLlmClient([matchesEchoingBatch, truncatedCompletion, matchesEchoingBatch]);

    const result = await matchLines({
      db: opened.db,
      sqlite: opened.sqlite,
      llm,
      logger,
      receiptId,
    });

    expect(llm.requests).toHaveLength(3);
    expect(result.warnings).toEqual(['MATCHING_FAILED']);
    // Batch 1 (ITEM 1-20) and batch 3 (ITEM 41-45) matched; batch 2 (ITEM 21-40) stayed unmatched.
    expect(getLine(lineIds[0]!)?.matchSource).toBe('llm');
    expect(getLine(lineIds[44]!)?.matchSource).toBe('llm');
    expect(getLine(lineIds[20]!)?.matchSource).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        receiptId,
        stage: 'matching',
        err: expect.objectContaining({
          cause: { finishReason: 'length', batchSize: 20 },
        }),
      }),
      'Product matching failed',
    );
  });
});
