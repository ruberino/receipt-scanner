import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type OpenedDatabase } from '../../../src/server/db/client.ts';
import { runMigrations } from '../../../src/server/db/migrate.ts';
import { receiptImages, receiptLines, receipts } from '../../../src/server/db/schema.ts';
import { createReceiptProcessor } from '../../../src/server/jobs/receiptProcessor.ts';
import { FakeLlmClient } from '../../../src/server/llm/FakeLlmClient.ts';
import type { JsonCompletionResult } from '../../../src/server/llm/LlmClient.ts';

const NOW = '2026-09-03T12:00:00.000Z';
const FIXED_NOW = () => new Date(NOW);
const LINE_TEXT = 'TINE LETTMELK 1L';

function extractionText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    storeName: 'REMA 1000 Grünerløkka',
    purchasedAt: '2026-09-03',
    total: 43.8,
    lines: [
      {
        text: LINE_TEXT,
        kind: 'item',
        quantity: 2,
        unit: 'stk',
        unitPrice: 21.9,
        totalPrice: 43.8,
      },
    ],
    ...overrides,
  });
}

function fakeExtraction(overrides: Partial<JsonCompletionResult> = {}): JsonCompletionResult {
  return {
    text: extractionText(),
    finishReason: 'stop',
    model: 'kimi-k2.6',
    usage: { promptTokens: 10, completionTokens: 5 },
    durationMs: 5,
    ...overrides,
  };
}

/** A matching response that creates a new product for LINE_TEXT; used whenever a test needs matching to succeed. */
function fakeMatch(): JsonCompletionResult {
  return {
    text: JSON.stringify({
      matches: [
        {
          text: LINE_TEXT,
          existingProduct: null,
          newProductName: 'Lettmelk 1 l',
          category: 'Meieri',
        },
      ],
    }),
    finishReason: 'stop',
    model: 'kimi-k2.6',
    usage: { promptTokens: 10, completionTokens: 5 },
    durationMs: 5,
  };
}

let opened: OpenedDatabase;

function createDb(): OpenedDatabase {
  const db = openDatabase(':memory:');
  runMigrations(db.db);
  return db;
}

function insertPendingReceipt(overrides: Partial<typeof receipts.$inferInsert> = {}): number {
  const receipt = opened.db
    .insert(receipts)
    .values({ status: 'pending', createdAt: NOW, updatedAt: NOW, ...overrides })
    .returning()
    .get();
  opened.db
    .insert(receiptImages)
    .values({
      receiptId: receipt.id,
      mimeType: 'image/jpeg',
      bytes: Buffer.from(`fake-image-${receipt.id}`),
      width: 100,
      height: 100,
      sha256: `${'a'.repeat(63)}${receipt.id}`,
    })
    .run();
  return receipt.id;
}

function getReceipt(id: number) {
  return opened.db.select().from(receipts).where(eq(receipts.id, id)).get();
}

function stubLogger(): FastifyBaseLogger {
  return { error: vi.fn() } as unknown as FastifyBaseLogger;
}

afterEach(() => {
  opened.sqlite.close();
});

describe('receiptProcessor', () => {
  it('processes an upload to done with the fake response and attempts 1, resolved by drain()', async () => {
    opened = createDb();
    const id = insertPendingReceipt();
    const llm = new FakeLlmClient([fakeExtraction(), fakeMatch()]);
    const processor = createReceiptProcessor({
      ...opened,
      llm,
      logger: stubLogger(),
      now: FIXED_NOW,
    });

    processor.enqueue(id);
    await processor.drain();

    const receipt = getReceipt(id);
    expect(receipt?.status).toBe('done');
    expect(receipt?.attempts).toBe(1);
    expect(receipt?.storeName).toBe('REMA 1000 Grünerløkka');
    const lines = opened.db.select().from(receiptLines).where(eq(receiptLines.receiptId, id)).all();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.totalOre).toBe(4380);
  });

  it('leaves a receipt failed with the Norwegian message when the LLM throws, then done with attempts 2 on retry', async () => {
    opened = createDb();
    const id = insertPendingReceipt();
    const llm = new FakeLlmClient([
      () => {
        throw new Error('network down');
      },
      fakeExtraction(),
      fakeMatch(),
    ]);
    const logger = { error: vi.fn() };
    const processor = createReceiptProcessor({
      ...opened,
      llm,
      logger: logger as unknown as FastifyBaseLogger,
      now: FIXED_NOW,
    });

    processor.enqueue(id);
    await processor.drain();

    let receipt = getReceipt(id);
    expect(receipt?.status).toBe('failed');
    expect(receipt?.errorMessage).toBe('Ukjent feil under lesing');
    expect(receipt?.attempts).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ receiptId: id, attempts: 1, stage: 'extraction' }),
      'Receipt processing failed',
    );

    processor.enqueue(id);
    await processor.drain();

    receipt = getReceipt(id);
    expect(receipt?.status).toBe('done');
    expect(receipt?.attempts).toBe(2);
  });

  it('replaces lines from an interrupted attempt instead of duplicating them', async () => {
    opened = createDb();
    const id = insertPendingReceipt({ status: 'processing' });
    opened.db
      .insert(receiptLines)
      .values([
        { receiptId: id, lineNo: 1, kind: 'item', rawText: 'OLD 1', totalOre: 100, createdAt: NOW },
        { receiptId: id, lineNo: 2, kind: 'item', rawText: 'OLD 2', totalOre: 200, createdAt: NOW },
      ])
      .run();
    const llm = new FakeLlmClient([fakeExtraction(), fakeMatch()]);
    const processor = createReceiptProcessor({
      ...opened,
      llm,
      logger: stubLogger(),
      now: FIXED_NOW,
    });

    processor.enqueue(id);
    await processor.drain();

    const lines = opened.db.select().from(receiptLines).where(eq(receiptLines.receiptId, id)).all();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.rawText).toBe(LINE_TEXT);
  });

  it('processes two uploads sequentially in id order', async () => {
    opened = createDb();
    const first = insertPendingReceipt();
    const second = insertPendingReceipt();
    // Up to 2 LLM calls per receipt (extraction + matching); extras are simply unused.
    const llm = new FakeLlmClient([fakeExtraction(), fakeMatch(), fakeExtraction(), fakeMatch()]);
    const processor = createReceiptProcessor({
      ...opened,
      llm,
      logger: stubLogger(),
      now: FIXED_NOW,
    });

    processor.enqueue(first);
    processor.enqueue(second);
    await processor.drain();

    const firstIndices = llm.requests.flatMap((r, i) => (r.receiptId === first ? [i] : []));
    const secondIndices = llm.requests.flatMap((r, i) => (r.receiptId === second ? [i] : []));
    expect(Math.max(...firstIndices)).toBeLessThan(Math.min(...secondIndices));
    expect(getReceipt(first)?.status).toBe('done');
    expect(getReceipt(second)?.status).toBe('done');
  });

  it('requeues pending and processing receipts on requeueUnfinished, in id order, and skips uploaded/done/failed ones', async () => {
    opened = createDb();
    const pending = insertPendingReceipt();
    const processing = insertPendingReceipt({ status: 'processing' });
    insertPendingReceipt({ status: 'uploaded' });
    insertPendingReceipt({ status: 'done' });
    insertPendingReceipt({ status: 'failed' });
    const llm = new FakeLlmClient([fakeExtraction(), fakeMatch(), fakeExtraction(), fakeMatch()]);
    const processor = createReceiptProcessor({
      ...opened,
      llm,
      logger: stubLogger(),
      now: FIXED_NOW,
    });

    processor.requeueUnfinished();
    await processor.drain();

    const pendingIndices = llm.requests.flatMap((r, i) => (r.receiptId === pending ? [i] : []));
    const processingIndices = llm.requests.flatMap((r, i) =>
      r.receiptId === processing ? [i] : [],
    );
    expect(Math.max(...pendingIndices)).toBeLessThan(Math.min(...processingIndices));
  });

  it('reports queueLength while processing and 0 once drained', async () => {
    opened = createDb();
    const id = insertPendingReceipt();
    const llm = new FakeLlmClient([fakeExtraction(), fakeMatch()]);
    const processor = createReceiptProcessor({
      ...opened,
      llm,
      logger: stubLogger(),
      now: FIXED_NOW,
    });

    expect(processor.queueLength()).toBe(0);
    processor.enqueue(id);
    expect(processor.queueLength()).toBe(1);
    await processor.drain();
    expect(processor.queueLength()).toBe(0);
  });

  it('adds POSSIBLE_DUPLICATE when store, date and total match a done receipt', async () => {
    opened = createDb();
    const firstId = insertPendingReceipt();
    const secondId = insertPendingReceipt();
    // The second receipt's line matches by alias (created while processing the first), so it needs
    // no matching call of its own; extras beyond what is actually consumed are simply unused.
    const llm = new FakeLlmClient([fakeExtraction(), fakeMatch(), fakeExtraction(), fakeMatch()]);
    const processor = createReceiptProcessor({
      ...opened,
      llm,
      logger: stubLogger(),
      now: FIXED_NOW,
    });

    processor.enqueue(firstId);
    await processor.drain();
    processor.enqueue(secondId);
    await processor.drain();

    const second = getReceipt(secondId);
    expect(second?.possibleDuplicateOf).toBe(firstId);
    expect(JSON.parse(second?.warningsJson ?? '[]')).toContain('POSSIBLE_DUPLICATE');
  });

  it('does not flag a duplicate when the total differs', async () => {
    opened = createDb();
    const firstId = insertPendingReceipt();
    const secondId = insertPendingReceipt();
    const llm = new FakeLlmClient([
      fakeExtraction(),
      fakeMatch(),
      fakeExtraction({ text: extractionText({ total: 99.9 }) }),
      fakeMatch(),
    ]);
    const processor = createReceiptProcessor({
      ...opened,
      llm,
      logger: stubLogger(),
      now: FIXED_NOW,
    });

    processor.enqueue(firstId);
    await processor.drain();
    processor.enqueue(secondId);
    await processor.drain();

    const second = getReceipt(secondId);
    expect(second?.possibleDuplicateOf).toBeNull();
    expect(JSON.parse(second?.warningsJson ?? '[]')).not.toContain('POSSIBLE_DUPLICATE');
  });
});
