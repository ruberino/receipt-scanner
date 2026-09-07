import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  acceptProposalSchema,
  createShoppingListItemSchema,
  patchShoppingListItemSchema,
  type ShoppingListProposalItem,
} from '../../shared/schemas.ts';
import { mondayOf, todayInOslo } from '../../shared/dates.ts';
import type { AppDatabase } from '../db/client.ts';
import {
  products,
  receiptLines,
  receipts,
  shoppingListDismissals,
  shoppingListItems,
  shoppingListProposals,
  shoppingLists,
} from '../db/schema.ts';
import { computeSuggestions } from '../domain/suggestions.ts';
import { loadProductHistories } from '../domain/productStats.ts';
import {
  buildProposalContext,
  type PreviousProposal,
  type PreviousProposalItem,
} from '../domain/proposalContext.ts';
import { computeTrip, type Trip, type TripItem, type TripLine } from '../domain/trip.ts';
import { runProposal } from '../llm/proposeList.ts';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.ts';
import { loadLineCounts, toReceiptSummary } from './receipts.ts';

export type ShoppingListsRouteOptions = {
  /** Same clock the receipts routes get, so `weekStart` is deterministic in tests. */
  now: () => Date;
};

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const acceptProposalParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  proposalId: z.coerce.number().int().positive(),
});
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

function toShoppingListSummary(
  db: AppDatabase,
  list: typeof shoppingLists.$inferSelect,
  itemCount: number,
) {
  return {
    id: list.id,
    weekStart: list.weekStart,
    status: list.status,
    createdAt: list.createdAt,
    completedAt: list.completedAt,
    itemCount,
    tripCounts: computeTripForList(db, list)?.counts ?? null,
  };
}

/** Left-joins `products` for `category` (T32): a product's own category wins when there is one,
 * otherwise the item's own stored `category` (T37 F2 — set only for a productless AI proposal). */
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
      category: sql<string | null>`coalesce(${products.category}, ${shoppingListItems.category})`,
    })
    .from(shoppingListItems)
    .leftJoin(products, eq(shoppingListItems.productId, products.id))
    .where(eq(shoppingListItems.listId, listId))
    .orderBy(shoppingListItems.position)
    .all();
}

/** For the single-item endpoints, which only have the raw row after an insert/update (no join);
 * `itemCategory` is that row's own `category` column, the T37 F2 fallback when there is no product. */
function loadItemCategory(
  db: AppDatabase,
  productId: number | null,
  itemCategory: string | null,
): string | null {
  if (productId === null) {
    return itemCategory;
  }
  const product = db
    .select({ category: products.category })
    .from(products)
    .where(eq(products.id, productId))
    .get();
  return product?.category ?? itemCategory;
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

function loadLinkedReceiptIds(db: AppDatabase, listId: number): number[] {
  return db
    .select({ id: receipts.id })
    .from(receipts)
    .where(eq(receipts.shoppingListId, listId))
    .all()
    .map((row) => row.id);
}

function loadLinkedReceipts(db: AppDatabase, listId: number) {
  const rows = db
    .select()
    .from(receipts)
    .where(eq(receipts.shoppingListId, listId))
    .orderBy(desc(receipts.id))
    .all();
  const lineCounts = loadLineCounts(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toReceiptSummary(row, lineCounts.get(row.id) ?? 0));
}

/** `item`-kind lines of the given receipts, for the trip comparison (T39, ADR-0018). */
function loadTripLines(db: AppDatabase, receiptIds: number[]): TripLine[] {
  if (receiptIds.length === 0) {
    return [];
  }
  return db
    .select({
      receiptId: receiptLines.receiptId,
      productId: receiptLines.productId,
      rawText: receiptLines.rawText,
      quantity: receiptLines.quantity,
      unit: receiptLines.unit,
    })
    .from(receiptLines)
    .where(and(inArray(receiptLines.receiptId, receiptIds), eq(receiptLines.kind, 'item')))
    .all()
    .map((line) => ({ ...line, unit: line.unit as TripLine['unit'] }));
}

function loadProductNames(db: AppDatabase, productIds: number[]): Map<number, string> {
  if (productIds.length === 0) {
    return new Map();
  }
  const rows = db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(inArray(products.id, productIds))
    .all();
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** `null` while the list is `open` or has no linked receipt (T39, ADR-0018); otherwise the
 * comparison of the list's items against the linked receipts' item lines, computed fresh.
 * Exported for the stats route, which sums trip counts across every `done` list. */
export function computeTripForList(
  db: AppDatabase,
  list: typeof shoppingLists.$inferSelect,
): Trip | null {
  if (list.status !== 'done') {
    return null;
  }
  const receiptIds = loadLinkedReceiptIds(db, list.id);
  if (receiptIds.length === 0) {
    return null;
  }

  const lines = loadTripLines(db, receiptIds);
  const productIds = [
    ...new Set(lines.map((line) => line.productId).filter((id): id is number => id !== null)),
  ];
  const items: TripItem[] = loadItems(db, list.id).map((item) => ({
    id: item.id,
    productId: item.productId,
    name: item.name,
    quantityText: item.quantityText,
    source: item.source as TripItem['source'],
    checked: item.checked === 1,
  }));

  return computeTrip({ items, lines, productNames: loadProductNames(db, productIds) });
}

function buildShoppingListDetail(db: AppDatabase, list: typeof shoppingLists.$inferSelect) {
  return {
    id: list.id,
    weekStart: list.weekStart,
    status: list.status,
    createdAt: list.createdAt,
    completedAt: list.completedAt,
    items: loadItems(db, list.id).map(toShoppingListItem),
    receipts: loadLinkedReceipts(db, list.id),
    trip: computeTripForList(db, list),
  };
}

function toShoppingListProposal(row: typeof shoppingListProposals.$inferSelect) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    model: row.model,
    items: JSON.parse(row.itemsJson) as ShoppingListProposalItem[],
  };
}

function loadPreviousProposals(db: AppDatabase, listId: number): PreviousProposal[] {
  return db
    .select()
    .from(shoppingListProposals)
    .where(eq(shoppingListProposals.listId, listId))
    .all()
    .map((row) => ({
      items: JSON.parse(row.itemsJson) as PreviousProposalItem[],
      acceptedIndexes:
        row.acceptedJson === null ? null : (JSON.parse(row.acceptedJson) as number[]),
    }));
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
    return lists.map((list) => toShoppingListSummary(app.db, list, itemCounts.get(list.id) ?? 0));
  });

  app.get('/api/shopping-lists/current', async () => {
    const list = findOpenList(app.db);
    if (!list) {
      throw new NotFoundError();
    }

    return buildShoppingListDetail(app.db, list);
  });

  app.get('/api/shopping-lists/:id', async (request) => {
    const params = idParamsSchema.parse(request.params);

    const list = app.db.select().from(shoppingLists).where(eq(shoppingLists.id, params.id)).get();
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

    reply.status(201).send(
      toShoppingListItem({
        ...created,
        category: loadItemCategory(app.db, created.productId, created.category),
      }),
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
      category: loadItemCategory(app.db, updated.productId, updated.category),
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

    // A removed product is dismissed for this list (T34), so a later refresh never re-adds it; a
    // manual item without a product leaves no trace. `onConflictDoNothing` since the same product
    // can only be dismissed once per list (the primary key), and re-removing it is not an error.
    const now = options.now().toISOString();
    app.sqlite.transaction(() => {
      app.db.delete(shoppingListItems).where(eq(shoppingListItems.id, params.id)).run();
      if (item.productId !== null) {
        app.db
          .insert(shoppingListDismissals)
          .values({ listId: item.listId, productId: item.productId, createdAt: now })
          .onConflictDoNothing()
          .run();
      }
    })();

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

  app.post('/api/shopping-lists/:id/refresh', async (request) => {
    const params = idParamsSchema.parse(request.params);

    const list = app.db.select().from(shoppingLists).where(eq(shoppingLists.id, params.id)).get();
    if (!list) {
      throw new NotFoundError();
    }
    if (list.status !== 'open') {
      throw new ConflictError('Listen er ikke åpen');
    }

    const today = todayInOslo(options.now());
    const suggestions = computeSuggestions(loadProductHistories(app.db), today);

    const existingProductIds = new Set(
      app.db
        .select({ productId: shoppingListItems.productId })
        .from(shoppingListItems)
        .where(eq(shoppingListItems.listId, params.id))
        .all()
        .map((row) => row.productId)
        .filter((productId): productId is number => productId !== null),
    );
    const dismissedProductIds = new Set(
      app.db
        .select({ productId: shoppingListDismissals.productId })
        .from(shoppingListDismissals)
        .where(eq(shoppingListDismissals.listId, params.id))
        .all()
        .map((row) => row.productId),
    );

    const now = options.now().toISOString();
    app.sqlite.transaction(() => {
      let position = nextPosition(app.db, params.id);
      for (const suggestion of suggestions) {
        if (
          existingProductIds.has(suggestion.productId) ||
          dismissedProductIds.has(suggestion.productId)
        ) {
          continue;
        }
        app.db
          .insert(shoppingListItems)
          .values({
            listId: params.id,
            productId: suggestion.productId,
            name: suggestion.name,
            quantityText: suggestion.quantityText,
            source: 'suggested',
            reason: suggestion.reason,
            checked: 0,
            position,
            createdAt: now,
          })
          .run();
        position += 1;
      }
    })();

    return buildShoppingListDetail(app.db, list);
  });

  app.post('/api/shopping-lists/:id/proposals', async (request, reply) => {
    const params = idParamsSchema.parse(request.params);

    const list = app.db.select().from(shoppingLists).where(eq(shoppingLists.id, params.id)).get();
    if (!list) {
      throw new NotFoundError();
    }
    if (list.status !== 'open') {
      throw new ConflictError('Listen er ikke åpen');
    }

    const dismissedProductIds = new Set(
      app.db
        .select({ productId: shoppingListDismissals.productId })
        .from(shoppingListDismissals)
        .where(eq(shoppingListDismissals.listId, params.id))
        .all()
        .map((row) => row.productId),
    );

    const context = buildProposalContext(
      {
        histories: loadProductHistories(app.db),
        list: {
          items: loadItems(app.db, params.id).map((item) => ({
            productId: item.productId,
            name: item.name,
          })),
        },
        dismissedProductIds,
        previousProposals: loadPreviousProposals(app.db, params.id),
        today: todayInOslo(options.now()),
      },
      request.log,
    );

    const result = await runProposal(app.llm, context, params.id, request.log);

    const now = options.now().toISOString();
    const created = app.db
      .insert(shoppingListProposals)
      .values({
        listId: params.id,
        model: result.model,
        promptVersion: result.promptVersion,
        itemsJson: JSON.stringify(result.items),
        rawResponse: result.rawResponse,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        durationMs: result.durationMs,
        acceptedJson: null,
        createdAt: now,
      })
      .returning()
      .get();

    reply.status(201).send(toShoppingListProposal(created));
  });

  app.post('/api/shopping-lists/:id/proposals/:proposalId/accept', async (request) => {
    const params = acceptProposalParamsSchema.parse(request.params);
    const body = acceptProposalSchema.parse(request.body);

    const list = app.db.select().from(shoppingLists).where(eq(shoppingLists.id, params.id)).get();
    if (!list) {
      throw new NotFoundError();
    }

    const proposal = app.db
      .select()
      .from(shoppingListProposals)
      .where(eq(shoppingListProposals.id, params.proposalId))
      .get();
    if (!proposal || proposal.listId !== params.id) {
      throw new NotFoundError();
    }
    if (list.status !== 'open') {
      throw new ConflictError('Listen er ikke åpen');
    }
    if (proposal.acceptedJson !== null) {
      throw new ConflictError('Forslaget er allerede behandlet');
    }

    const items = JSON.parse(proposal.itemsJson) as ShoppingListProposalItem[];
    const itemByIndex = new Map(items.map((item) => [item.index, item]));
    const onListProductIds = new Set(
      app.db
        .select({ productId: shoppingListItems.productId })
        .from(shoppingListItems)
        .where(eq(shoppingListItems.listId, params.id))
        .all()
        .map((row) => row.productId)
        .filter((productId): productId is number => productId !== null),
    );

    const now = options.now().toISOString();
    app.sqlite.transaction(() => {
      let position = nextPosition(app.db, params.id);
      for (const index of body.indexes) {
        const item = itemByIndex.get(index);
        if (!item) {
          continue;
        }
        if (item.productId !== null && onListProductIds.has(item.productId)) {
          continue;
        }

        app.db
          .insert(shoppingListItems)
          .values({
            listId: params.id,
            productId: item.productId,
            name: item.name,
            quantityText: item.quantityText,
            source: 'ai',
            reason: item.reason,
            // Set even when there is a product too (harmless, and consistent): `loadItems`/
            // `loadItemCategory` only fall back to it once the product itself has none (T37 F2).
            category: item.category,
            checked: 0,
            position,
            createdAt: now,
          })
          .run();
        position += 1;
        if (item.productId !== null) {
          onListProductIds.add(item.productId);
        }
      }

      app.db
        .update(shoppingListProposals)
        .set({ acceptedJson: JSON.stringify(body.indexes) })
        .where(eq(shoppingListProposals.id, params.proposalId))
        .run();
    })();

    const updatedList = app.db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.id, params.id))
      .get();
    return buildShoppingListDetail(app.db, updatedList!);
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
    const completionDay = todayInOslo(options.now());
    const updated = app.sqlite.transaction(() => {
      const updatedList = app.db
        .update(shoppingLists)
        .set({ status: 'done', completedAt: now })
        .where(eq(shoppingLists.id, params.id))
        .returning()
        .get();

      // Same-day only, no one-day tolerance (T39, ADR-0018): the receipt was scanned before or
      // after the button was pressed, but a receipt from yesterday belongs to yesterday's trip,
      // and one from tomorrow cannot exist yet.
      app.db
        .update(receipts)
        .set({ shoppingListId: params.id })
        .where(
          and(
            eq(receipts.status, 'done'),
            isNull(receipts.shoppingListId),
            eq(receipts.purchasedAt, completionDay),
          ),
        )
        .run();

      return updatedList;
    })();

    return buildShoppingListDetail(app.db, updated);
  });
}
