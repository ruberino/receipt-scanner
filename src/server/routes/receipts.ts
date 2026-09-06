import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { isUniqueViolation } from '../db/client.ts';
import { products, receiptImages, receiptLines, receipts } from '../db/schema.ts';
import { matchLines, type MatchLinesWarning } from '../domain/matching.ts';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.ts';
import { normaliseImage } from '../lib/images.ts';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
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
  };
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

export default async function receiptsRoutes(app: FastifyInstance): Promise<void> {
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
          .values({ status: 'pending', createdAt: now, updatedAt: now })
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

    app.receiptProcessor.enqueue(receipt.id);

    reply.status(202).send({ id: receipt.id });
  });

  app.get('/api/receipts/:id', async (request) => {
    const params = idParamsSchema.parse(request.params);

    const receipt = app.db.select().from(receipts).where(eq(receipts.id, params.id)).get();
    if (!receipt) {
      throw new NotFoundError();
    }

    return buildReceiptDetail(app, receipt);
  });

  app.post('/api/receipts/:id/retry', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const receipt = app.db.select().from(receipts).where(eq(receipts.id, params.id)).get();
    if (!receipt) {
      throw new NotFoundError();
    }
    if (receipt.status !== 'failed') {
      throw new ConflictError('Kvitteringen er ikke feilet');
    }

    const now = new Date().toISOString();
    const updated = app.db
      .update(receipts)
      .set({ status: 'pending', errorMessage: null, updatedAt: now })
      .where(eq(receipts.id, params.id))
      .returning()
      .get();

    app.receiptProcessor.enqueue(params.id);

    const lineCount = app.db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, params.id))
      .all().length;

    reply.status(202).send(toReceiptSummary(updated, lineCount));
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
