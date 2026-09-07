import type { FastifyInstance } from 'fastify';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createShoppingListItemSchema, patchShoppingListItemSchema } from '../../shared/schemas.ts';
import { mondayOf, todayInOslo } from '../../shared/dates.ts';
import type { AppDatabase } from '../db/client.ts';
import { products, shoppingListItems, shoppingLists } from '../db/schema.ts';
import { computeSuggestions } from '../domain/suggestions.ts';
import { loadProductHistories } from '../domain/productStats.ts';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.ts';

export type ShoppingListsRouteOptions = {
  /** Same clock the receipts routes get, so `weekStart` is deterministic in tests. */
  now: () => Date;
};

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function findOpenList(db: AppDatabase) {
  return db.select().from(shoppingLists).where(eq(shoppingLists.status, 'open')).get();
}

function loadItemCounts(db: AppDatabase, listIds: number[]): Map<number, number> {
  if (listIds.length === 0) {
    return new Map();
  }
  const rows = db
    .select({ listId: shoppingListItems.listId, count: sql<number>`count(*)` })
    .from(shoppingListItems)
    .where(inArray(shoppingListItems.listId, listIds))
    .groupBy(shoppingListItems.listId)
    .all();
  return new Map(rows.map((row) => [row.listId, row.count]));
}

function toShoppingListSummary(list: typeof shoppingLists.$inferSelect, itemCount: number) {
  return {
    id: list.id,
    weekStart: list.weekStart,
    status: list.status,
    createdAt: list.createdAt,
    completedAt: list.completedAt,
    itemCount,
  };
}

/** Left-joins `products` for `category` (T32): derived on read, not stored, so no migration. */
function loadItems(db: AppDatabase, listId: number) {
  return db
    .select({
      id: shoppingListItems.id,
      productId: shoppingListItems.productId,
      name: shoppingListItems.name,
      quantityText: shoppingListItems.quantityText,
      source: shoppingListItems.source,
      reason: shoppingListItems.reason,
      checked: shoppingListItems.checked,
      position: shoppingListItems.position,
      category: products.category,
    })
    .from(shoppingListItems)
    .leftJoin(products, eq(shoppingListItems.productId, products.id))
    .where(eq(shoppingListItems.listId, listId))
    .orderBy(shoppingListItems.position)
    .all();
}

/** For the single-item endpoints, which only have the raw row after an insert/update (no join). */
function loadItemCategory(db: AppDatabase, productId: number | null): string | null {
  if (productId === null) {
    return null;
  }
  const product = db
    .select({ category: products.category })
    .from(products)
    .where(eq(products.id, productId))
    .get();
  return product?.category ?? null;
}

function nextPosition(db: AppDatabase, listId: number): number {
  const row = db
    .select({ max: sql<number | null>`max(${shoppingListItems.position})` })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId))
    .get();
  return (row?.max ?? 0) + 1;
}

function toShoppingListItem(item: {
  id: number;
  productId: number | null;
  name: string;
  quantityText: string | null;
  source: string;
  reason: string | null;
  checked: number;
  position: number;
  category: string | null;
}) {
  return {
    id: item.id,
    productId: item.productId,
    name: item.name,
    quantityText: item.quantityText,
    source: item.source,
    reason: item.reason,
    checked: item.checked === 1,
    position: item.position,
    category: item.category,
  };
}

function buildShoppingListDetail(db: AppDatabase, list: typeof shoppingLists.$inferSelect) {
  return {
    id: list.id,
    weekStart: list.weekStart,
    status: list.status,
    createdAt: list.createdAt,
    completedAt: list.completedAt,
    items: loadItems(db, list.id).map(toShoppingListItem),
  };
}

export default async function shoppingListsRoutes(
  app: FastifyInstance,
  options: ShoppingListsRouteOptions,
): Promise<void> {
  app.post('/api/shopping-lists', async (request, reply) => {
    const existing = findOpenList(app.db);
    if (existing) {
      reply.status(200).send(buildShoppingListDetail(app.db, existing));
      return;
    }

    const now = options.now().toISOString();
    const today = todayInOslo(options.now());
    const suggestions = computeSuggestions(loadProductHistories(app.db), today);

    const created = app.sqlite.transaction(() => {
      const list = app.db
        .insert(shoppingLists)
        .values({ weekStart: mondayOf(today), status: 'open', createdAt: now })
        .returning()
        .get();

      suggestions.forEach((suggestion, index) => {
        app.db
          .insert(shoppingListItems)
          .values({
            listId: list.id,
            productId: suggestion.productId,
            name: suggestion.name,
            quantityText: suggestion.quantityText,
            source: 'suggested',
            reason: suggestion.reason,
            checked: 0,
            position: index + 1,
            createdAt: now,
          })
          .run();
      });

      return list;
    })();

    reply.status(201).send(buildShoppingListDetail(app.db, created));
  });

  app.get('/api/shopping-lists', async (request) => {
    const query = listQuerySchema.parse(request.query);

    const lists = app.db
      .select()
      .from(shoppingLists)
      .orderBy(desc(shoppingLists.weekStart), desc(shoppingLists.id))
      .limit(query.limit)
      .all();

    const itemCounts = loadItemCounts(
      app.db,
      lists.map((list) => list.id),
    );
    return lists.map((list) => toShoppingListSummary(list, itemCounts.get(list.id) ?? 0));
  });

  app.get('/api/shopping-lists/current', async () => {
    const list = findOpenList(app.db);
    if (!list) {
      throw new NotFoundError();
    }

    return buildShoppingListDetail(app.db, list);
  });

  app.post('/api/shopping-lists/:id/items', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);
    const body = createShoppingListItemSchema.parse(request.body);

    const list = app.db.select().from(shoppingLists).where(eq(shoppingLists.id, params.id)).get();
    if (!list) {
      throw new NotFoundError();
    }
    if (list.status !== 'open') {
      throw new ConflictError('Handlelisten er fullført');
    }

    if (body.productId !== undefined) {
      const product = app.db.select().from(products).where(eq(products.id, body.productId)).get();
      if (!product) {
        throw new ValidationError('Ukjent produkt');
      }
    }

    const now = options.now().toISOString();
    const created = app.db
      .insert(shoppingListItems)
      .values({
        listId: params.id,
        productId: body.productId ?? null,
        name: body.name,
        quantityText: body.quantityText ?? null,
        source: 'manual',
        reason: null,
        checked: 0,
        position: nextPosition(app.db, params.id),
        createdAt: now,
      })
      .returning()
      .get();

    reply
      .status(201)
      .send(
        toShoppingListItem({ ...created, category: loadItemCategory(app.db, created.productId) }),
      );
  });

  app.patch('/api/shopping-list-items/:id', async (request) => {
    const params = idParamsSchema.parse(request.params);
    const body = patchShoppingListItemSchema.parse(request.body);

    const item = app.db
      .select()
      .from(shoppingListItems)
      .where(eq(shoppingListItems.id, params.id))
      .get();
    if (!item) {
      throw new NotFoundError();
    }

    const list = app.db.select().from(shoppingLists).where(eq(shoppingLists.id, item.listId)).get();
    if (list?.status !== 'open') {
      throw new ConflictError('Handlelisten er fullført');
    }

    const updated = app.db
      .update(shoppingListItems)
      .set({
        checked: body.checked === undefined ? item.checked : body.checked ? 1 : 0,
        name: body.name ?? item.name,
        quantityText: body.quantityText === undefined ? item.quantityText : body.quantityText,
        position: body.position ?? item.position,
      })
      .where(eq(shoppingListItems.id, params.id))
      .returning()
      .get();

    return toShoppingListItem({
      ...updated,
      category: loadItemCategory(app.db, updated.productId),
    });
  });

  app.delete('/api/shopping-list-items/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const item = app.db
      .select()
      .from(shoppingListItems)
      .where(eq(shoppingListItems.id, params.id))
      .get();
    if (!item) {
      throw new NotFoundError();
    }

    const list = app.db.select().from(shoppingLists).where(eq(shoppingLists.id, item.listId)).get();
    if (list?.status !== 'open') {
      throw new ConflictError('Handlelisten er fullført');
    }

    app.db.delete(shoppingListItems).where(eq(shoppingListItems.id, params.id)).run();

    reply.status(204).send();
  });

  app.post('/api/shopping-lists/:id/reopen', async (request) => {
    const params = idParamsSchema.parse(request.params);

    const list = app.db.select().from(shoppingLists).where(eq(shoppingLists.id, params.id)).get();
    if (!list) {
      throw new NotFoundError();
    }

    const today = todayInOslo(options.now());
    const completedToday =
      list.completedAt !== null && todayInOslo(new Date(list.completedAt)) === today;
    if (list.status !== 'done' || !completedToday || findOpenList(app.db)) {
      throw new ConflictError('Listen kan ikke gjenåpnes');
    }

    const updated = app.db
      .update(shoppingLists)
      .set({ status: 'open', completedAt: null })
      .where(eq(shoppingLists.id, params.id))
      .returning()
      .get();

    return buildShoppingListDetail(app.db, updated);
  });

  app.delete('/api/shopping-lists/:id', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const list = app.db.select().from(shoppingLists).where(eq(shoppingLists.id, params.id)).get();
    if (!list) {
      throw new NotFoundError();
    }
    if (list.status !== 'open') {
      throw new ConflictError('En fullført liste kan ikke slettes');
    }

    app.db.delete(shoppingLists).where(eq(shoppingLists.id, params.id)).run();

    reply.status(204).send();
  });

  app.post('/api/shopping-lists/:id/complete', async (request) => {
    const params = idParamsSchema.parse(request.params);

    const list = app.db.select().from(shoppingLists).where(eq(shoppingLists.id, params.id)).get();
    if (!list) {
      throw new NotFoundError();
    }
    if (list.status !== 'open') {
      throw new ConflictError('Handlelisten er allerede fullført');
    }

    const now = options.now().toISOString();
    const updated = app.db
      .update(shoppingLists)
      .set({ status: 'done', completedAt: now })
      .where(eq(shoppingLists.id, params.id))
      .returning()
      .get();

    return buildShoppingListDetail(app.db, updated);
  });
}
