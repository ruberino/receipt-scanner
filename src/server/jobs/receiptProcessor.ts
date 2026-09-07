import type Database from 'better-sqlite3';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { todayInOslo } from '../../shared/dates.ts';
import type { AppDatabase } from '../db/client.ts';
import { receiptImages, receiptLines, receipts } from '../db/schema.ts';
import { applyExtraction, findPossibleDuplicate } from '../domain/extraction.ts';
import { matchLines } from '../domain/matching.ts';
import { ExtractionError, type ExtractionStage } from '../lib/errors.ts';
import { runExtraction } from '../llm/extractReceipt.ts';
import type { LlmClient } from '../llm/LlmClient.ts';

export type ReceiptProcessorDeps = {
  db: AppDatabase;
  sqlite: InstanceType<typeof Database>;
  llm: LlmClient;
  logger: FastifyBaseLogger;
  /** Defaults to `() => new Date()`; tests pin it to make `todayInOslo` deterministic. */
  now?: () => Date;
};

export type ReceiptProcessor = {
  enqueue(receiptId: number): void;
  requeueUnfinished(): void;
  queueLength(): number;
  /** Resolves once every enqueued receipt has finished processing; tests use this instead of timers. */
  drain(): Promise<void>;
};

async function processReceipt(deps: ReceiptProcessorDeps, receiptId: number): Promise<void> {
  const { db, sqlite, llm, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const nowIso = () => now().toISOString();

  const before = db.select().from(receipts).where(eq(receipts.id, receiptId)).get();
  if (!before) {
    logger.error({ receiptId }, 'Receipt not found when starting to process it');
    return;
  }
  const attempts = before.attempts + 1;
  db.update(receipts)
    .set({ status: 'processing', attempts, updatedAt: nowIso() })
    .where(eq(receipts.id, receiptId))
    .run();

  let stage: ExtractionStage = 'extraction';
  try {
    const image = db
      .select()
      .from(receiptImages)
      .where(eq(receiptImages.receiptId, receiptId))
      .get();
    if (!image) {
      throw new Error(`Receipt ${receiptId} has no stored image`);
    }
    const extraction = await runExtraction(llm, image.bytes, receiptId);
    const scanDate = todayInOslo(now());
    const applied = applyExtraction(extraction.result, scanDate);

    const warnings = [...applied.warnings];
    const duplicateOf = findPossibleDuplicate(
      db,
      receiptId,
      applied.storeName,
      applied.purchasedAt,
      applied.totalOre,
    );
    if (duplicateOf !== null) {
      warnings.push('POSSIBLE_DUPLICATE');
    }

    // Saved while still `processing`: matching (below) needs the lines in place, and a retry after
    // a crash here must not duplicate them, so delete-then-insert stays in the same transaction.
    sqlite.transaction(() => {
      db.delete(receiptLines).where(eq(receiptLines.receiptId, receiptId)).run();
      db.update(receipts)
        .set({
          storeName: applied.storeName,
          purchasedAt: applied.purchasedAt,
          totalOre: applied.totalOre,
          warningsJson: JSON.stringify(warnings),
          extractionJson: JSON.stringify(extraction.result),
          rawResponse: extraction.raw,
          promptVersion: extraction.promptVersion,
          model: extraction.model,
          possibleDuplicateOf: duplicateOf,
          updatedAt: nowIso(),
        })
        .where(eq(receipts.id, receiptId))
        .run();
      for (const line of applied.lines) {
        db.insert(receiptLines)
          .values({
            receiptId,
            lineNo: line.lineNo,
            kind: line.kind,
            rawText: line.rawText,
            quantity: line.quantity,
            unit: line.unit,
            unitPriceOre: line.unitPriceOre,
            totalOre: line.totalOre,
            createdAt: nowIso(),
          })
          .run();
      }
    })();

    stage = 'matching';
    // matchLines never throws for an LLM/parsing failure; it returns MATCHING_FAILED instead, so
    // only a genuine extraction failure above ends the receipt as `failed`.
    const matched = await matchLines({ db, sqlite, llm, logger, receiptId });
    const finalWarnings = [...warnings, ...matched.warnings];

    db.update(receipts)
      .set({ status: 'done', warningsJson: JSON.stringify(finalWarnings), updatedAt: nowIso() })
      .where(eq(receipts.id, receiptId))
      .run();
  } catch (error) {
    const errorMessage =
      error instanceof ExtractionError ? error.userMessage : 'Ukjent feil under lesing';
    db.update(receipts)
      .set({ status: 'failed', errorMessage, updatedAt: nowIso() })
      .where(eq(receipts.id, receiptId))
      .run();
    logger.error({ err: error, receiptId, attempts, stage }, 'Receipt processing failed');
  }
}

export function createReceiptProcessor(deps: ReceiptProcessorDeps): ReceiptProcessor {
  const queue: number[] = [];
  let active = false;
  let drainWaiters: Array<() => void> = [];

  function settleIfIdle(): void {
    if (active || queue.length > 0) {
      return;
    }
    const waiters = drainWaiters;
    drainWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  function runNext(): void {
    if (active) {
      return;
    }
    const nextId = queue.shift();
    if (nextId === undefined) {
      settleIfIdle();
      return;
    }
    active = true;
    processReceipt(deps, nextId)
      .catch((error: unknown) => {
        deps.logger.error({ err: error, receiptId: nextId }, 'Unexpected job runner error');
      })
      .finally(() => {
        active = false;
        runNext();
      });
  }

  return {
    enqueue(receiptId: number): void {
      queue.push(receiptId);
      runNext();
    },
    requeueUnfinished(): void {
      const unfinished = deps.db
        .select({ id: receipts.id })
        .from(receipts)
        .where(inArray(receipts.status, ['pending', 'processing']))
        .orderBy(receipts.id)
        .all();
      for (const row of unfinished) {
        queue.push(row.id);
      }
      runNext();
    },
    queueLength(): number {
      return queue.length + (active ? 1 : 0);
    },
    drain(): Promise<void> {
      return new Promise((resolve) => {
        if (!active && queue.length === 0) {
          resolve();
          return;
        }
        drainWaiters.push(resolve);
      });
    },
  };
}
