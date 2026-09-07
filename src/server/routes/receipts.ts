import type { FastifyInstance } from 'fastify';
import { desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { patchReceiptSchema } from '../../shared/schemas.ts';
import { diffDays, todayInOslo } from '../../shared/dates.ts';
import type { AppDatabase } from '../db/client.ts';
import { isUniqueViolation } from '../db/client.ts';
import { products, receiptImages, receiptLines, receipts } from '../db/schema.ts';
import { findPossibleDuplicate } from '../domain/extraction.ts';
import { matchLines, type MatchLinesWarning } from '../domain/matching.ts';
import { computeLineSum, TOTAL_MATCH_TOLERANCE_ORE } from '../domain/receiptWarnings.ts';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.ts';
import { normaliseImage } from '../lib/images.ts';

export type ReceiptsRouteOptions = {
  /** Same clock the job runner gets, so FUTURE_DATE recomputation is deterministic in tests. */
  now: () => Date;
};

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
});
const MATCHING_WARNINGS: readonly MatchLinesWarning[] = ['UNMATCHED_LINES', 'MATCHING_FAILED'];

function toReceiptSummary(receipt: typeof receipts.$inferSelect, lineCount: number) {
  return {
    id: receipt.id,
    status: receipt.status,
    storeName: receipt.storeName,
    purchasedAt: receipt.purchasedAt,
    totalOre: receipt.totalOre,
    lineCount,
    warnings: JSON.parse(receipt.warningsJson) as string[],
    errorMessage: receipt.errorMessage,
    possibleDuplicateOf: receipt.possibleDuplicateOf,
    reviewedAt: receipt.reviewedAt,
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
  };
}

/** One `count(*) ... group by receipt_id` for however many receipts are asked about, instead of a query per receipt. */
function loadLineCounts(db: AppDatabase, receiptIds: number[]): Map<number, number> {
  if (receiptIds.length === 0) {
    return new Map();
  }
  const rows = db
    .select({ receiptId: receiptLines.receiptId, count: sql<number>`count(*)` })
    .from(receiptLines)
    .where(inArray(receiptLines.receiptId, receiptIds))
    .groupBy(receiptLines.receiptId)
    .all();
  return new Map(rows.map((row) => [row.receiptId, row.count]));
}

function loadLineCount(db: AppDatabase, receiptId: number): number {
  return loadLineCounts(db, [receiptId]).get(receiptId) ?? 0;
}

function buildReceiptDetail(app: FastifyInstance, receipt: typeof receipts.$inferSelect) {
  const lines = app.db
    .select({
      id: receiptLines.id,
      lineNo: receiptLines.lineNo,
      kind: receiptLines.kind,
      rawText: receiptLines.rawText,
      quantity: receiptLines.quantity,
      unit: receiptLines.unit,
      unitPriceOre: receiptLines.unitPriceOre,
      totalOre: receiptLines.totalOre,
      matchSource: receiptLines.matchSource,
      product: { id: products.id, name: products.name, category: products.category },
    })
    .from(receiptLines)
    .leftJoin(products, eq(receiptLines.productId, products.id))
    .where(eq(receiptLines.receiptId, receipt.id))
    .orderBy(receiptLines.lineNo)
    .all();

  return {
    ...toReceiptSummary(receipt, lines.length),
    imageUrl: `/api/receipts/${receipt.id}/image`,
    lines: lines.map((line) => ({
      ...line,
      product: line.product?.id == null ? null : line.product,
    })),
  };
}

export default async function receiptsRoutes(
  app: FastifyInstance,
  options: ReceiptsRouteOptions,
): Promise<void> {
  app.post('/api/receipts', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new ValidationError('Ingen fil ble sendt');
    }

    // A file over config.maxUploadBytes makes @fastify/multipart throw a 413 here, which
    // appErrorFromHttpError (T02) maps to the documented PAYLOAD_TOO_LARGE body.
    const buffer = await file.toBuffer();
    const normalised = await normaliseImage(buffer);

    // A pre-check narrows the common case to a clean 409 without a failed insert in the log; the
    // unique index is still the source of truth for two identical uploads racing each other.
    const existingImage = app.db
      .select()
      .from(receiptImages)
      .where(eq(receiptImages.sha256, normalised.sha256))
      .get();
    if (existingImage) {
      throw new ConflictError('Denne kvitteringen er allerede skannet', {
        existingReceiptId: existingImage.receiptId,
      });
    }

    const now = new Date().toISOString();
    let receipt: typeof receipts.$inferSelect;
    try {
      receipt = app.sqlite.transaction(() => {
        const inserted = app.db
          .insert(receipts)
          .values({ status: 'uploaded', createdAt: now, updatedAt: now })
          .returning()
          .get();
        app.db
          .insert(receiptImages)
          .values({
            receiptId: inserted.id,
            mimeType: 'image/jpeg',
            bytes: normalised.bytes,
            width: normalised.width,
            height: normalised.height,
            sha256: normalised.sha256,
          })
          .run();
        return inserted;
      })();
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raceWinner = app.db
          .select()
          .from(receiptImages)
          .where(eq(receiptImages.sha256, normalised.sha256))
          .get();
        throw new ConflictError('Denne kvitteringen er allerede skannet', {
          existingReceiptId: raceWinner?.receiptId,
        });
      }
      throw error;
    }

    reply.status(201).send({ id: receipt.id });
  });

  app.get('/api/receipts', async (request) => {
    const query = listQuerySchema.parse(request.query);

    const rows = app.db
      .select()
      .from(receipts)
      .where(query.before !== undefined ? lt(receipts.id, query.before) : undefined)
      .orderBy(desc(receipts.id))
      .limit(query.limit)
      .all();

    const lineCounts = loadLineCounts(
      app.db,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toReceiptSummary(row, lineCounts.get(row.id) ?? 0));
  });

  app.get('/api/receipts/:id', async (request) => {
    const params = idParamsSchema.parse(request.params);

    const receipt = app.db.select().from(receipts).where(eq(receipts.id, params.id)).get();
    if (!receipt) {
      throw new NotFoundError();
    }

    return buildReceiptDetail(app, receipt);
  });

  app.patch('/api/receipts/:id', async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = patchReceiptSchema.parse(request.body);

    const receipt = app.db.select().from(receipts).where(eq(receipts.id, params.id)).get();
    if (!receipt) {
      throw new NotFoundError();
    }
    if (receipt.status !== 'done') {
      throw new ConflictError('Kvitteringen er ikke ferdig behandlet');
    }

    const nextStoreName = 'storeName' in body ? (body.storeName ?? null) : receipt.storeName;
    const nextPurchasedAt = body.purchasedAt ?? receipt.purchasedAt;
    const nextTotalOre = body.totalOre ?? receipt.totalOre;
    const recomputeChecks =
      body.storeName !== undefined || body.purchasedAt !== undefined || body.totalOre !== undefined;

    let warnings = JSON.parse(receipt.warningsJson) as string[];
    let possibleDuplicateOf = receipt.possibleDuplicateOf;

    if (body.storeName !== undefined) {
      warnings = warnings.filter((w) => w !== 'MISSING_STORE');
      if (nextStoreName === null) {
        warnings.push('MISSING_STORE');
      }
    }

    if (body.purchasedAt !== undefined) {
      warnings = warnings.filter((w) => w !== 'MISSING_DATE' && w !== 'FUTURE_DATE');
      const scanDate = todayInOslo(options.now());
      if (diffDays(scanDate, body.purchasedAt) > 0) {
        warnings.push('FUTURE_DATE');
      }
    }

    if (recomputeChecks) {
      warnings = warnings.filter((w) => w !== 'TOTAL_MISMATCH' && w !== 'POSSIBLE_DUPLICATE');

      const lineSum = computeLineSum(app.db, params.id);
      if (nextTotalOre === null || Math.abs(lineSum - nextTotalOre) > TOTAL_MATCH_TOLERANCE_ORE) {
        warnings.push('TOTAL_MISMATCH');
      }

      possibleDuplicateOf =
        nextPurchasedAt !== null && nextTotalOre !== null
          ? findPossibleDuplicate(app.db, params.id, nextStoreName, nextPurchasedAt, nextTotalOre)
          : null;
      if (possibleDuplicateOf !== null) {
        warnings.push('POSSIBLE_DUPLICATE');
      }
    }

    const now = new Date().toISOString();
    const updated = app.db
      .update(receipts)
      .set({
        storeName: nextStoreName,
        purchasedAt: nextPurchasedAt,
        totalOre: nextTotalOre,
        warningsJson: JSON.stringify(warnings),
        possibleDuplicateOf,
        reviewedAt: body.reviewed === true ? now : receipt.reviewedAt,
        updatedAt: now,
      })
      .where(eq(receipts.id, params.id))
      .returning()
      .get();

    return buildReceiptDetail(app, updated);
  });

  app.delete('/api/receipts/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const receipt = app.db.select().from(receipts).where(eq(receipts.id, params.id)).get();
    if (!receipt) {
      throw new NotFoundError();
    }

    // receipt_images and receipt_lines cascade via their foreign keys (architecture.md section 6).
    app.db.delete(receipts).where(eq(receipts.id, params.id)).run();

    reply.status(204).send();
  });

  app.post('/api/receipts/:id/scan', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const receipt = app.db.select().from(receipts).where(eq(receipts.id, params.id)).get();
    if (!receipt) {
      throw new NotFoundError();
    }
    if (receipt.status !== 'uploaded' && receipt.status !== 'failed') {
      throw new ConflictError('Kvitteringen kan ikke skannes nå');
    }

    const now = new Date().toISOString();
    const updated = app.db
      .update(receipts)
      .set({ status: 'pending', errorMessage: null, updatedAt: now })
      .where(eq(receipts.id, params.id))
      .returning()
      .get();

    app.receiptProcessor.enqueue(params.id);

    reply.status(202).send(toReceiptSummary(updated, loadLineCount(app.db, params.id)));
  });

  app.post('/api/receipts/:id/rematch', async (request) => {
    const params = idParamsSchema.parse(request.params);

    const receipt = app.db.select().from(receipts).where(eq(receipts.id, params.id)).get();
    if (!receipt) {
      throw new NotFoundError();
    }

    const matched = await matchLines({
      db: app.db,
      sqlite: app.sqlite,
      llm: app.llm,
      logger: request.log,
      receiptId: params.id,
    });

    const keptWarnings = (JSON.parse(receipt.warningsJson) as string[]).filter(
      (warning) => !MATCHING_WARNINGS.includes(warning as MatchLinesWarning),
    );
    app.db
      .update(receipts)
      .set({
        warningsJson: JSON.stringify([...keptWarnings, ...matched.warnings]),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(receipts.id, params.id))
      .run();

    const updatedReceipt = app.db.select().from(receipts).where(eq(receipts.id, params.id)).get();
    return buildReceiptDetail(app, updatedReceipt!);
  });

  app.get('/api/receipts/:id/image', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const image = app.db
      .select()
      .from(receiptImages)
      .where(eq(receiptImages.receiptId, params.id))
      .get();
    if (!image) {
      throw new NotFoundError();
    }

    reply.header('Cache-Control', 'private, max-age=86400');
    reply.type(image.mimeType);
    return image.bytes;
  });
}
