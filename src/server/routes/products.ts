import type { FastifyInstance } from 'fastify';
import { and, desc, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import {
  createProductSchema,
  mergeProductSchema,
  patchProductSchema,
} from '../../shared/schemas.ts';
import type { AppDatabase } from '../db/client.ts';
import { isUniqueViolation } from '../db/client.ts';
import { productAliases, products, receiptLines, receipts } from '../db/schema.ts';
import { mergeProducts } from '../domain/merge.ts';
import {
  loadProductStats,
  loadProductStatsMap,
  type ProductStats,
} from '../domain/productStats.ts';
import { ConflictError, NotFoundError } from '../lib/errors.ts';
import { normalizeText } from '../../shared/normalize.ts';

const NO_STATS: ProductStats = { timesBought: 0, lastBought: null, medianIntervalDays: null };

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const listQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  // z.coerce.boolean() would turn "?includeSuppressed=false" into true (Boolean('false') is truthy).
  includeSuppressed: z.enum(['true', 'false']).optional(),
});

export function toProduct(product: typeof products.$inferSelect, stats: ProductStats) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    suppressed: product.suppressed === 1,
    timesBought: stats.timesBought,
    lastBought: stats.lastBought,
    medianIntervalDays: stats.medianIntervalDays,
  };
}

function findByNameNormalized(db: AppDatabase, nameNormalized: string) {
  return db.select().from(products).where(eq(products.nameNormalized, nameNormalized)).get();
}

export default async function productsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/products', async (request) => {
    const query = listQuerySchema.parse(request.query);

    const conditions = [
      query.q !== undefined
        ? like(products.nameNormalized, `%${normalizeText(query.q)}%`)
        : undefined,
      query.includeSuppressed === 'true' ? undefined : eq(products.suppressed, 0),
    ].filter((condition) => condition !== undefined);

    const rows = app.db
      .select()
      .from(products)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .all();

    const statsByProduct = loadProductStatsMap(app.db);

    return rows
      .map((row) => toProduct(row, statsByProduct.get(row.id) ?? NO_STATS))
      .sort((a, b) => b.timesBought - a.timesBought || a.name.localeCompare(b.name, 'nb'));
  });

  app.get('/api/products/:id', async (request) => {
    const params = idParamsSchema.parse(request.params);

    const product = app.db.select().from(products).where(eq(products.id, params.id)).get();
    if (!product) {
      throw new NotFoundError();
    }

    const aliases = app.db
      .select()
      .from(productAliases)
      .where(eq(productAliases.productId, params.id))
      .all();

    const purchases = app.db
      .select({
        receiptId: receiptLines.receiptId,
        date: receipts.purchasedAt,
        storeName: receipts.storeName,
        quantity: receiptLines.quantity,
        unit: receiptLines.unit,
        totalOre: receiptLines.totalOre,
      })
      .from(receiptLines)
      .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
      .where(
        and(
          eq(receiptLines.productId, params.id),
          eq(receiptLines.kind, 'item'),
          eq(receipts.status, 'done'),
        ),
      )
      .orderBy(desc(receipts.purchasedAt), desc(receiptLines.id))
      .all();

    return {
      ...toProduct(product, loadProductStats(app.db, params.id)),
      aliases: aliases.map((alias) => ({
        id: alias.id,
        alias: alias.aliasNormalized,
        source: alias.source,
      })),
      purchases,
    };
  });

  app.post('/api/products', async (request, reply) => {
    const body = createProductSchema.parse(request.body);
    const nameNormalized = normalizeText(body.name);

    if (findByNameNormalized(app.db, nameNormalized)) {
      throw new ConflictError('Et produkt med dette navnet finnes allerede');
    }

    const now = new Date().toISOString();
    let created: typeof products.$inferSelect;
    try {
      created = app.db
        .insert(products)
        .values({
          name: body.name,
          nameNormalized,
          category: body.category ?? 'Annet',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Et produkt med dette navnet finnes allerede');
      }
      throw error;
    }

    reply.status(201).send(toProduct(created, loadProductStats(app.db, created.id)));
  });

  app.patch('/api/products/:id', async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = patchProductSchema.parse(request.body);

    const product = app.db.select().from(products).where(eq(products.id, params.id)).get();
    if (!product) {
      throw new NotFoundError();
    }

    const nameNormalized =
      body.name !== undefined ? normalizeText(body.name) : product.nameNormalized;
    if (body.name !== undefined) {
      const existing = findByNameNormalized(app.db, nameNormalized);
      if (existing && existing.id !== params.id) {
        throw new ConflictError('Et produkt med dette navnet finnes allerede');
      }
    }

    const updated = app.db
      .update(products)
      .set({
        name: body.name ?? product.name,
        nameNormalized,
        category: body.category ?? product.category,
        suppressed: body.suppressed === undefined ? product.suppressed : body.suppressed ? 1 : 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(products.id, params.id))
      .returning()
      .get();

    return toProduct(updated, loadProductStats(app.db, updated.id));
  });

  app.post('/api/products/:id/merge', async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = mergeProductSchema.parse(request.body);

    const target = mergeProducts(app.sqlite, app.db, params.id, body.intoProductId);

    return toProduct(target, loadProductStats(app.db, target.id));
  });

  app.delete('/api/product-aliases/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const alias = app.db
      .select()
      .from(productAliases)
      .where(eq(productAliases.id, params.id))
      .get();
    if (!alias) {
      throw new NotFoundError();
    }

    app.db.delete(productAliases).where(eq(productAliases.id, params.id)).run();

    reply.status(204).send();
  });
}
