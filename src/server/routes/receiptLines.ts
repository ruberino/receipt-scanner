import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { patchReceiptLineSchema } from '../../shared/schemas.ts';
import { productAliases, products, receiptLines, receipts } from '../db/schema.ts';
import { NotFoundError, ValidationError } from '../lib/errors.ts';
import { normalizeText } from '../../shared/normalize.ts';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export default async function receiptLinesRoutes(app: FastifyInstance): Promise<void> {
  app.patch('/api/receipt-lines/:id', async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = patchReceiptLineSchema.parse(request.body);

    const line = app.db.select().from(receiptLines).where(eq(receiptLines.id, params.id)).get();
    if (!line) {
      throw new NotFoundError();
    }

    const now = new Date().toISOString();
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

      const stillUnmatched = app.db
        .select({ id: receiptLines.id })
        .from(receiptLines)
        .where(
          and(
            eq(receiptLines.receiptId, line.receiptId),
            eq(receiptLines.kind, 'item'),
            isNull(receiptLines.productId),
          ),
        )
        .get();

      if (!stillUnmatched) {
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

    return {
      id: updatedLine!.id,
      lineNo: updatedLine!.lineNo,
      kind: updatedLine!.kind,
      rawText: updatedLine!.rawText,
      quantity: updatedLine!.quantity,
      unit: updatedLine!.unit,
      unitPriceOre: updatedLine!.unitPriceOre,
      totalOre: updatedLine!.totalOre,
      product: product ? { id: product.id, name: product.name, category: product.category } : null,
      matchSource: updatedLine!.matchSource,
    };
  });
}
