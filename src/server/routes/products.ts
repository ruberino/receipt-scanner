import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { z } from 'zod';
import {
  attachProductParentSchema,
  createProductGroupSchema,
  createProductSchema,
  mergeProductSchema,
  patchProductSchema,
} from '../../shared/schemas.ts';
import type { AppDatabase } from '../db/client.ts';
import { isUniqueViolation } from '../db/client.ts';
import { productAliases, products, receiptLines, receipts } from '../db/schema.ts';
import { mergeProducts } from '../domain/merge.ts';
import { findGroupCandidates } from '../domain/productGroups.ts';
import {
  computeProductStats,
  loadProductStats,
  loadProductStatsMap,
  type ProductStats,
} from '../domain/productStats.ts';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.ts';
import { normalizeText } from '../../shared/normalize.ts';

const NO_STATS: ProductStats = { timesBought: 0, lastBought: null, medianIntervalDays: null };

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const listQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  // z.coerce.boolean() would turn "?includeSuppressed=false" into true (Boolean('false') is truthy).
  includeSuppressed: z.enum(['true', 'false']).optional(),
});

export function toProduct(
  product: typeof products.$inferSelect,
  stats: ProductStats,
  variantCount: number,
) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    suppressed: product.suppressed === 1,
    timesBought: stats.timesBought,
    lastBought: stats.lastBought,
    medianIntervalDays: stats.medianIntervalDays,
    parentId: product.parentId,
    variantCount,
  };
}

function findByNameNormalized(db: AppDatabase, nameNormalized: string) {
  return db.select().from(products).where(eq(products.nameNormalized, nameNormalized)).get();
}

function countVariants(db: AppDatabase, productId: number): number {
  return db.select({ id: products.id }).from(products).where(eq(products.parentId, productId)).all()
    .length;
}

function loadParent(db: AppDatabase, parentId: number | null): { id: number; name: string } | null {
  if (parentId === null) {
    return null;
  }
  return (
    db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(eq(products.id, parentId))
      .get() ?? null
  );
}

/** The folded stats across a parent and its variants (T40, ADR-0019): the same shape as a single
 * product's own stats, computed over every `done` item line for the whole group. */
function loadGroupStats(db: AppDatabase, parentId: number, childIds: number[]): ProductStats {
  const rows = db
    .select({ date: receipts.purchasedAt })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(
      and(
        inArray(receiptLines.productId, [parentId, ...childIds]),
        eq(receipts.status, 'done'),
        eq(receiptLines.kind, 'item'),
      ),
    )
    .all();
  return computeProductStats(rows.map((row) => row.date as string));
}

/** `null` when the product does not exist; otherwise the full `ProductDetail` shape, shared by
 * `GET /api/products/:id` and `POST /api/product-groups` (T40, ADR-0019). */
function buildProductDetail(db: AppDatabase, id: number) {
  const product = db.select().from(products).where(eq(products.id, id)).get();
  if (!product) {
    return null;
  }

  const aliases = db.select().from(productAliases).where(eq(productAliases.productId, id)).all();

  const purchases = db
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
        eq(receiptLines.productId, id),
        eq(receiptLines.kind, 'item'),
        eq(receipts.status, 'done'),
      ),
    )
    .orderBy(desc(receipts.purchasedAt), desc(receiptLines.id))
    .all();

  const childRows = db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.parentId, id))
    .orderBy(products.name)
    .all();
  const variants = childRows.map((child) => {
    const stats = loadProductStats(db, child.id);
    return {
      id: child.id,
      name: child.name,
      timesBought: stats.timesBought,
      lastBought: stats.lastBought,
    };
  });
  const groupStats =
    childRows.length > 0
      ? loadGroupStats(
          db,
          id,
          childRows.map((child) => child.id),
        )
      : null;

  return {
    ...toProduct(product, loadProductStats(db, id), childRows.length),
    aliases: aliases.map((alias) => ({
      id: alias.id,
      alias: alias.aliasNormalized,
      source: alias.source,
    })),
    purchases,
    parent: loadParent(db, product.parentId),
    variants,
    groupStats,
  };
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
    const variantCounts = new Map<number, number>();
    for (const row of rows) {
      if (row.parentId !== null) {
        variantCounts.set(row.parentId, (variantCounts.get(row.parentId) ?? 0) + 1);
      }
    }

    const sorted = rows
      .map((row) =>
        toProduct(row, statsByProduct.get(row.id) ?? NO_STATS, variantCounts.get(row.id) ?? 0),
      )
      .sort((a, b) => b.timesBought - a.timesBought || a.name.localeCompare(b.name, 'nb'));

    // A child sorts directly after its parent when both are in the result (T40, ADR-0019).
    const resultIds = new Set(sorted.map((row) => row.id));
    const childrenByParent = new Map<number, typeof sorted>();
    for (const row of sorted) {
      if (row.parentId !== null && resultIds.has(row.parentId)) {
        const siblings = childrenByParent.get(row.parentId) ?? [];
        siblings.push(row);
        childrenByParent.set(row.parentId, siblings);
      }
    }
    const ordered: typeof sorted = [];
    for (const row of sorted) {
      if (row.parentId !== null && resultIds.has(row.parentId)) {
        continue; // placed right after its parent below
      }
      ordered.push(row);
      const children = childrenByParent.get(row.id);
      if (children) {
        ordered.push(...children);
      }
    }
    return ordered;
  });

  app.get('/api/products/group-candidates', async () => {
    const rows = app.db
      .select({
        id: products.id,
        name: products.name,
        category: products.category,
        parentId: products.parentId,
        suppressed: products.suppressed,
      })
      .from(products)
      .all();

    return findGroupCandidates(rows.map((row) => ({ ...row, suppressed: row.suppressed === 1 })));
  });

  app.get('/api/products/:id', async (request) => {
    const params = idParamsSchema.parse(request.params);

    const detail = buildProductDetail(app.db, params.id);
    if (!detail) {
      throw new NotFoundError();
    }
    return detail;
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

    reply.status(201).send(toProduct(created, loadProductStats(app.db, created.id), 0));
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

    return toProduct(
      updated,
      loadProductStats(app.db, updated.id),
      countVariants(app.db, updated.id),
    );
  });

  app.post('/api/products/:id/merge', async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = mergeProductSchema.parse(request.body);

    const target = mergeProducts(app.sqlite, app.db, params.id, body.intoProductId);

    return toProduct(target, loadProductStats(app.db, target.id), countVariants(app.db, target.id));
  });

  app.post('/api/products/:id/parent', async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = attachProductParentSchema.parse(request.body);

    if (body.parentId === params.id) {
      throw new ValidationError('Et produkt kan ikke være sin egen varegruppe');
    }

    const child = app.db.select().from(products).where(eq(products.id, params.id)).get();
    const parent = app.db.select().from(products).where(eq(products.id, body.parentId)).get();
    if (!child || !parent) {
      throw new NotFoundError();
    }
    if (countVariants(app.db, params.id) > 0) {
      throw new ConflictError('Produktet er allerede en varegruppe');
    }
    if (parent.parentId !== null) {
      throw new ConflictError('Varegruppen kan ikke ligge i en annen gruppe');
    }

    const updated = app.db
      .update(products)
      .set({ parentId: body.parentId, updatedAt: new Date().toISOString() })
      .where(eq(products.id, params.id))
      .returning()
      .get();

    return toProduct(updated, loadProductStats(app.db, updated.id), 0);
  });

  app.delete('/api/products/:id/parent', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const product = app.db.select().from(products).where(eq(products.id, params.id)).get();
    if (!product) {
      throw new NotFoundError();
    }
    if (product.parentId === null) {
      throw new NotFoundError('Produktet er ikke i en varegruppe');
    }

    app.db
      .update(products)
      .set({ parentId: null, updatedAt: new Date().toISOString() })
      .where(eq(products.id, params.id))
      .run();

    reply.status(204).send();
  });

  app.post('/api/product-groups', async (request, reply) => {
    const body = createProductGroupSchema.parse(request.body);
    const nameNormalized = normalizeText(body.name);

    if (findByNameNormalized(app.db, nameNormalized)) {
      throw new ConflictError('Et produkt med dette navnet finnes allerede');
    }

    const members = app.db
      .select()
      .from(products)
      .where(inArray(products.id, body.memberIds))
      .all();
    if (members.length !== body.memberIds.length) {
      throw new NotFoundError();
    }
    for (const member of members) {
      if (countVariants(app.db, member.id) > 0) {
        throw new ConflictError('Produktet er allerede en varegruppe');
      }
      if (member.parentId !== null) {
        throw new ConflictError('Varegruppen kan ikke ligge i en annen gruppe');
      }
    }

    const now = new Date().toISOString();
    const category = body.category ?? members[0]!.category ?? 'Annet';

    let createdId: number;
    try {
      createdId = app.sqlite.transaction(() => {
        const parent = app.db
          .insert(products)
          .values({ name: body.name, nameNormalized, category, createdAt: now, updatedAt: now })
          .returning()
          .get();

        app.db
          .update(products)
          .set({ parentId: parent.id, updatedAt: now })
          .where(inArray(products.id, body.memberIds))
          .run();

        return parent.id;
      })();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Et produkt med dette navnet finnes allerede');
      }
      throw error;
    }

    reply.status(201).send(buildProductDetail(app.db, createdId));
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
