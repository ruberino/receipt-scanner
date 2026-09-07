import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { patchReceiptLineSchema } from '../../shared/schemas.ts';
import type { AppDatabase } from '../db/client.ts';
import { productAliases, products, receiptLines, receipts } from '../db/schema.ts';
import {
  computeLineSum,
  hasUnmatchedItemLine,
  TOTAL_MATCH_TOLERANCE_ORE,
} from '../domain/receiptWarnings.ts';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.ts';
import { normalizeText } from '../../shared/normalize.ts';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

function toReceiptLineResponse(
  line: typeof receiptLines.$inferSelect,
  product: typeof products.$inferSelect | undefined,
) {
  return {
    id: line.id,
    lineNo: line.lineNo,
    kind: line.kind,
    rawText: line.rawText,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceOre: line.unitPriceOre,
    totalOre: line.totalOre,
    product: product ? { id: product.id, name: product.name, category: product.category } : null,
    matchSource: line.matchSource,
  };
}

/** Recomputes TOTAL_MISMATCH and UNMATCHED_LINES from the current lines, leaving every other
 * warning alone; bumps `updated_at` (T29, same rule PATCH /api/receipts/:id and T25 use). */
function recomputeLineWarnings(
  db: AppDatabase,
  receiptId: number,
  receipt: { totalOre: number | null; warningsJson: string },
  now: string,
): void {
  const warnings = (JSON.parse(receipt.warningsJson) as string[]).filter(
    (warning) => warning !== 'TOTAL_MISMATCH' && warning !== 'UNMATCHED_LINES',
  );

  const lineSum = computeLineSum(db, receiptId);
  if (
    receipt.totalOre === null ||
    Math.abs(lineSum - receipt.totalOre) > TOTAL_MATCH_TOLERANCE_ORE
  ) {
    warnings.push('TOTAL_MISMATCH');
  }
  if (hasUnmatchedItemLine(db, receiptId)) {
    warnings.push('UNMATCHED_LINES');
  }

  db.update(receipts)
    .set({ warningsJson: JSON.stringify(warnings), updatedAt: now })
    .where(eq(receipts.id, receiptId))
    .run();
}

export default async function receiptLinesRoutes(app: FastifyInstance): Promise<void> {
  app.patch('/api/receipt-lines/:id', async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = patchReceiptLineSchema.parse(request.body);

    const line = app.db.select().from(receiptLines).where(eq(receiptLines.id, params.id)).get();
    if (!line) {
      throw new NotFoundError();
    }

    const now = new Date().toISOString();

    if (!('productId' in body) && !('newProductName' in body)) {
      const receipt = app.db.select().from(receipts).where(eq(receipts.id, line.receiptId)).get();
      if (receipt?.status !== 'done') {
        throw new ConflictError('Kvitteringen er ikke ferdig behandlet');
      }

      if (body.totalOre !== undefined) {
        const resultingKind = body.kind ?? line.kind;
        if (resultingKind === 'discount' && body.totalOre > 0) {
          throw new ValidationError('Beløpet for en rabatt kan ikke være positivt');
        }
        if (resultingKind !== 'discount' && body.totalOre < 0) {
          throw new ValidationError('Beløpet kan ikke være negativt');
        }
      }

      app.sqlite.transaction(() => {
        const updates: Partial<typeof receiptLines.$inferInsert> = {};
        if (body.totalOre !== undefined) {
          updates.totalOre = body.totalOre;
        }
        if (body.quantity !== undefined) {
          updates.quantity = body.quantity;
        }
        if (body.unitPriceOre !== undefined) {
          updates.unitPriceOre = body.unitPriceOre;
        }
        if (body.kind !== undefined) {
          updates.kind = body.kind;
          if (body.kind !== 'item') {
            updates.productId = null;
            updates.matchSource = null;
          }
        }

        app.db.update(receiptLines).set(updates).where(eq(receiptLines.id, params.id)).run();
        recomputeLineWarnings(app.db, line.receiptId, receipt, now);
      })();

      const updatedLine = app.db
        .select()
        .from(receiptLines)
        .where(eq(receiptLines.id, params.id))
        .get();
      const product =
        updatedLine!.productId !== null
          ? app.db.select().from(products).where(eq(products.id, updatedLine!.productId)).get()
          : undefined;

      return toReceiptLineResponse(updatedLine!, product);
    }

    const aliasKey = normalizeText(line.rawText);

    const productId = app.sqlite.transaction(() => {
      let resolvedProductId: number;

      if ('productId' in body) {
        const product = app.db.select().from(products).where(eq(products.id, body.productId)).get();
        if (!product) {
          throw new ValidationError('Ukjent produkt');
        }
        resolvedProductId = product.id;
      } else {
        const nameNormalized = normalizeText(body.newProductName);
        const existing = app.db
          .select()
          .from(products)
          .where(eq(products.nameNormalized, nameNormalized))
          .get();
        if (existing) {
          resolvedProductId = existing.id;
        } else {
          const created = app.db
            .insert(products)
            .values({
              name: body.newProductName.trim(),
              nameNormalized,
              category: body.category ?? 'Annet',
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          resolvedProductId = created.id;
        }
      }

      const existingAlias = app.db
        .select()
        .from(productAliases)
        .where(eq(productAliases.aliasNormalized, aliasKey))
        .get();
      if (existingAlias) {
        app.db
          .update(productAliases)
          .set({ productId: resolvedProductId, source: 'user' })
          .where(eq(productAliases.id, existingAlias.id))
          .run();
      } else {
        app.db
          .insert(productAliases)
          .values({
            aliasNormalized: aliasKey,
            productId: resolvedProductId,
            source: 'user',
            createdAt: now,
          })
          .run();
      }

      app.db
        .update(receiptLines)
        .set({ productId: resolvedProductId, matchSource: 'user' })
        .where(eq(receiptLines.id, params.id))
        .run();

      if (!hasUnmatchedItemLine(app.db, line.receiptId)) {
        const receipt = app.db.select().from(receipts).where(eq(receipts.id, line.receiptId)).get();
        if (receipt) {
          const warnings = (JSON.parse(receipt.warningsJson) as string[]).filter(
            (warning) => warning !== 'UNMATCHED_LINES',
          );
          app.db
            .update(receipts)
            .set({ warningsJson: JSON.stringify(warnings), updatedAt: now })
            .where(eq(receipts.id, line.receiptId))
            .run();
        }
      }

      return resolvedProductId;
    })();

    const updatedLine = app.db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.id, params.id))
      .get();
    const product = app.db.select().from(products).where(eq(products.id, productId)).get();

    return toReceiptLineResponse(updatedLine!, product);
  });

  app.delete('/api/receipt-lines/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const line = app.db.select().from(receiptLines).where(eq(receiptLines.id, params.id)).get();
    if (!line) {
      throw new NotFoundError();
    }

    const receipt = app.db.select().from(receipts).where(eq(receipts.id, line.receiptId)).get();
    if (receipt?.status !== 'done') {
      throw new ConflictError('Kvitteringen er ikke ferdig behandlet');
    }

    const now = new Date().toISOString();
    app.sqlite.transaction(() => {
      app.db.delete(receiptLines).where(eq(receiptLines.id, params.id)).run();
      recomputeLineWarnings(app.db, line.receiptId, receipt, now);
    })();

    reply.status(204).send();
  });
}
