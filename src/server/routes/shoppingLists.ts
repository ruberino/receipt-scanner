import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
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

function findOpenList(db: AppDatabase) {
  return db.select().from(shoppingLists).where(eq(shoppingLists.status, 'open')).get();
}

function loadItems(db: AppDatabase, listId: number) {
  return db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId))
    .orderBy(shoppingListItems.position)
    .all();
}

function nextPosition(db: AppDatabase, listId: number): number {
  const row = db
    .select({ max: sql<number | null>`max(${shoppingListItems.position})` })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId))
    .get();
  return (row?.max ?? 0) + 1;
}

function toShoppingListItem(item: typeof shoppingListItems.$inferSelect) {
  return {
    id: item.id,
    productId: item.productId,
    name: item.name,
    quantityText: item.quantityText,
    source: item.source,
    reason: item.reason,
    checked: item.checked === 1,
    position: item.position,
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

    reply.status(201).send(toShoppingListItem(created));
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

    return toShoppingListItem(updated);
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
