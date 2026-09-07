import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  products,
  receiptLines,
  receipts,
  shoppingListDismissals,
  shoppingListItems,
  shoppingListProposals,
  shoppingLists,
} from '../../src/server/db/schema.ts';
import { FakeLlmClient } from '../../src/server/llm/FakeLlmClient.ts';
import type { ShoppingListProposalItem } from '../../src/shared/schemas.ts';
import { createTestApp } from '../helpers/createTestApp.ts';
import { loginCookie } from '../helpers/login.ts';

const NOW = '2026-09-04T12:00:00.000Z';

let app: FastifyInstance | undefined;
let cookie: string;

function insertProduct(name: string): number {
  return app!.db
    .insert(products)
    .values({
      name,
      nameNormalized: name.toUpperCase(),
      category: 'Meieri',
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get().id;
}

function insertDoneReceiptWithLine(purchasedAt: string, productId: number): void {
  const receiptId = app!.db
    .insert(receipts)
    .values({
      status: 'done',
      purchasedAt,
      totalOre: 100,
      warningsJson: '[]',
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get().id;
  app!.db
    .insert(receiptLines)
    .values({
      receiptId,
      lineNo: 1,
      kind: 'item',
      rawText: 'line',
      totalOre: 100,
      productId,
      createdAt: NOW,
    })
    .run();
}

function insertOpenList(weekStart = '2026-08-31'): number {
  return app!.db
    .insert(shoppingLists)
    .values({ weekStart, status: 'open', createdAt: NOW })
    .returning()
    .get().id;
}

function insertDoneList(weekStart = '2026-08-24', completedAt = NOW): number {
  return app!.db
    .insert(shoppingLists)
    .values({ weekStart, status: 'done', createdAt: NOW, completedAt })
    .returning()
    .get().id;
}

function insertItem(
  listId: number,
  position: number,
  overrides: Partial<typeof shoppingListItems.$inferInsert> = {},
): number {
  return app!.db
    .insert(shoppingListItems)
    .values({
      listId,
      name: `Vare ${position}`,
      source: 'manual',
      checked: 0,
      position,
      createdAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertProposal(
  listId: number,
  items: ShoppingListProposalItem[],
  overrides: Partial<typeof shoppingListProposals.$inferInsert> = {},
): number {
  return app!.db
    .insert(shoppingListProposals)
    .values({
      listId,
      model: 'grok-4.6',
      promptVersion: 1,
      itemsJson: JSON.stringify(items),
      rawResponse: '{}',
      promptTokens: 500,
      completionTokens: 200,
      durationMs: 800,
      acceptedJson: null,
      createdAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function proposalCompletion(items: unknown[]) {
  return {
    text: JSON.stringify({ items }),
    finishReason: 'stop',
    model: 'grok-4.6',
    usage: { promptTokens: 500, completionTokens: 200 },
    durationMs: 800,
  };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST /api/shopping-lists', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'POST', url: '/api/shopping-lists' });

    expect(response.statusCode).toBe(401);
  });

  it('creates a list from suggestions in score order, weekStart = mondayOf(today)', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    const coffee = insertProduct('Kaffe');
    for (const date of ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']) {
      insertDoneReceiptWithLine(date, milk);
    }
    for (const date of ['2026-07-24', '2026-08-14']) {
      insertDoneReceiptWithLine(date, coffee);
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.weekStart).toBe('2026-08-31');
    expect(body.status).toBe('open');
    expect(body.createdAt).toBe(NOW);
    expect(body.items.map((item: { name: string }) => item.name)).toEqual([
      'Kaffe',
      'Lettmelk 1 l',
    ]);
    expect(body.items[0]).toMatchObject({ productId: coffee, source: 'suggested', position: 1 });
    expect(body.items[1]).toMatchObject({ productId: milk, source: 'suggested', position: 2 });
  });

  it('returns the existing open list with 200 when creating a second time', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);

    const first = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists',
      headers: { cookie },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists',
      headers: { cookie },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(
      app.db.select().from(shoppingLists).where(eq(shoppingLists.status, 'open')).all(),
    ).toHaveLength(1);
  });
});

describe('GET /api/shopping-lists', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/shopping-lists' });

    expect(response.statusCode).toBe(401);
  });

  it('returns history newest week first, with an item count and no items array, including the open list', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const older = insertDoneList('2026-08-17');
    insertItem(older, 1);
    const newer = insertDoneList('2026-08-24');
    insertItem(newer, 1);
    insertItem(newer, 2);
    const open = insertOpenList('2026-08-31');
    insertItem(open, 1);
    insertItem(open, 2);
    insertItem(open, 3);

    const response = await app.inject({
      method: 'GET',
      url: '/api/shopping-lists',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.map((list: { id: number }) => list.id)).toEqual([open, newer, older]);
    expect(body[0]).toEqual({
      id: open,
      weekStart: '2026-08-31',
      status: 'open',
      createdAt: NOW,
      completedAt: null,
      itemCount: 3,
    });
    expect(body[1]).toMatchObject({ weekStart: '2026-08-24', status: 'done', itemCount: 2 });
    expect(body[2]).toMatchObject({ weekStart: '2026-08-17', status: 'done', itemCount: 1 });
    expect(body.every((list: Record<string, unknown>) => !('items' in list))).toBe(true);
  });

  it('breaks a tie on the same weekStart by id descending', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const first = insertDoneList('2026-08-24');
    const second = insertDoneList('2026-08-24');

    const response = await app.inject({
      method: 'GET',
      url: '/api/shopping-lists',
      headers: { cookie },
    });

    expect(response.json().map((list: { id: number }) => list.id)).toEqual([second, first]);
  });

  it('respects the limit query parameter', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    insertDoneList('2026-08-10');
    insertDoneList('2026-08-17');
    insertDoneList('2026-08-24');

    const response = await app.inject({
      method: 'GET',
      url: '/api/shopping-lists?limit=2',
      headers: { cookie },
    });

    expect(response.json()).toHaveLength(2);
  });
});

describe('GET /api/shopping-lists/current', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/shopping-lists/current' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 when no list is open', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    insertDoneList();

    const response = await app.inject({
      method: 'GET',
      url: '/api/shopping-lists/current',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns the open list with its items ordered by position', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    insertItem(listId, 2, { name: 'Banan' });
    insertItem(listId, 1, { name: 'Eple' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/shopping-lists/current',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { name: string }) => item.name)).toEqual([
      'Eple',
      'Banan',
    ]);
  });

  it("carries the product's category for a matched item, and null for a manual one without a product (T32)", async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    const listId = insertOpenList();
    insertItem(listId, 1, { name: 'Lettmelk 1 l', productId: milk, source: 'suggested' });
    insertItem(listId, 2, { name: 'Handlenett' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/shopping-lists/current',
      headers: { cookie },
    });

    const items = response.json().items;
    expect(items[0]).toMatchObject({ name: 'Lettmelk 1 l', category: 'Meieri' });
    expect(items[1]).toMatchObject({ name: 'Handlenett', category: null });
  });

  it("falls back to the item's own category only when it has no product (T37 F2)", async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    const listId = insertOpenList();
    insertItem(listId, 1, { name: 'Plommer', category: 'Frukt og grønt', source: 'ai' });
    insertItem(listId, 2, {
      name: 'Lettmelk 1 l',
      productId: milk,
      category: 'Snacks',
      source: 'ai',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/shopping-lists/current',
      headers: { cookie },
    });

    const items = response.json().items;
    expect(items[0]).toMatchObject({ name: 'Plommer', category: 'Frukt og grønt' });
    // The product's own category wins over the item's own, even though one was stored (T37 F2).
    expect(items[1]).toMatchObject({ name: 'Lettmelk 1 l', category: 'Meieri' });
  });
});

describe('POST /api/shopping-lists/:id/items', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists/1/items',
      payload: { name: 'Ost' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown list', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists/999/items',
      payload: { name: 'Ost' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 409 for a done list', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertDoneList();

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/items`,
      payload: { name: 'Ost' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('gives 400 for an unknown productId', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/items`,
      payload: { name: 'Ost', productId: 999 },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it('appends a manual item last', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    insertItem(listId, 1, { name: 'Eple', source: 'suggested', reason: 'x' });
    insertItem(listId, 2, { name: 'Banan', source: 'suggested', reason: 'x' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/items`,
      payload: { name: 'Ost' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: 'Ost',
      source: 'manual',
      position: 3,
      category: null,
    });
  });

  it("returns the product's category when created with a productId (T32)", async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const milk = insertProduct('Lettmelk 1 l');

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/items`,
      payload: { name: 'Lettmelk 1 l', productId: milk },
      headers: { cookie },
    });

    expect(response.json()).toMatchObject({ category: 'Meieri' });
  });
});

describe('PATCH /api/shopping-list-items/:id', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/shopping-list-items/1',
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown item', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/shopping-list-items/999',
      payload: {},
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 409 when the list is done', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertDoneList();
    const itemId = insertItem(listId, 1);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/shopping-list-items/${itemId}`,
      payload: { checked: true },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('gives 400 for an unknown field', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const itemId = insertItem(listId, 1);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/shopping-list-items/${itemId}`,
      payload: { nope: true },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it('gives 400 for position 0 (positions are 1-based)', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const itemId = insertItem(listId, 1);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/shopping-list-items/${itemId}`,
      payload: { position: 0 },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it("updates checked, name, quantityText and position, and keeps the product's category unchanged (T32)", async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const milk = insertProduct('Lettmelk 1 l');
    const itemId = insertItem(listId, 1, { productId: milk });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/shopping-list-items/${itemId}`,
      payload: { checked: true, name: 'Ny navn', quantityText: '2 stk', position: 5 },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      checked: true,
      name: 'Ny navn',
      quantityText: '2 stk',
      position: 5,
      category: 'Meieri',
    });
  });
});

describe('DELETE /api/shopping-list-items/:id', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'DELETE', url: '/api/shopping-list-items/1' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown item', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/shopping-list-items/999',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 409 when the list is done', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertDoneList();
    const itemId = insertItem(listId, 1);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/shopping-list-items/${itemId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('deletes the item', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const itemId = insertItem(listId, 1);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/shopping-list-items/${itemId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(204);
    expect(
      app.db.select().from(shoppingListItems).where(eq(shoppingListItems.id, itemId)).get(),
    ).toBeUndefined();
  });

  it('records a dismissal when the deleted item has a product (T34)', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const milk = insertProduct('Lettmelk 1 l');
    const itemId = insertItem(listId, 1, { productId: milk });

    await app.inject({
      method: 'DELETE',
      url: `/api/shopping-list-items/${itemId}`,
      headers: { cookie },
    });

    expect(
      app.db
        .select()
        .from(shoppingListDismissals)
        .where(eq(shoppingListDismissals.listId, listId))
        .all(),
    ).toEqual([{ listId, productId: milk, createdAt: expect.any(String) }]);
  });

  it('records no dismissal for a manual item without a product (T34)', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const itemId = insertItem(listId, 1);

    await app.inject({
      method: 'DELETE',
      url: `/api/shopping-list-items/${itemId}`,
      headers: { cookie },
    });

    expect(app.db.select().from(shoppingListDismissals).all()).toHaveLength(0);
  });
});

describe('POST /api/shopping-lists/:id/reopen', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'POST', url: '/api/shopping-lists/1/reopen' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown list', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists/999/reopen',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('reopens a list completed today in Oslo, restoring its items and clearing completedAt', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertDoneList('2026-08-31', NOW);
    insertItem(listId, 1, { name: 'Kaffe', checked: 1 });

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/reopen`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ id: listId, status: 'open', completedAt: null });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ name: 'Kaffe', checked: true });
  });

  it('reopens when completedAt is just after midnight in Oslo, even though the UTC date is still yesterday', async () => {
    // 2026-09-03T22:30:00Z is 2026-09-04T00:30 CEST: "today" in Oslo, same as NOW's Oslo day.
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertDoneList('2026-08-31', '2026-09-03T22:30:00.000Z');

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/reopen`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
  });

  it('gives 409 when completed on an earlier day in Oslo', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertDoneList('2026-08-24', '2026-09-03T12:00:00.000Z');

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/reopen`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('gives 409 when another list is already open', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertDoneList('2026-08-31', NOW);
    insertOpenList('2026-09-07');

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/reopen`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('gives 409 for a list that is still open', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertOpenList();

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/reopen`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('DELETE /api/shopping-lists/:id', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'DELETE', url: '/api/shopping-lists/1' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown list', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/shopping-lists/999',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 409 for a done list', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertDoneList();

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/shopping-lists/${listId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('deletes an open list and cascades its items', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const itemId = insertItem(listId, 1);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/shopping-lists/${listId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(204);
    expect(
      app.db.select().from(shoppingLists).where(eq(shoppingLists.id, listId)).get(),
    ).toBeUndefined();
    expect(
      app.db.select().from(shoppingListItems).where(eq(shoppingListItems.id, itemId)).get(),
    ).toBeUndefined();
  });
});

describe('POST /api/shopping-lists/:id/refresh', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'POST', url: '/api/shopping-lists/1/refresh' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown list', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists/999/refresh',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 409 when the list is done', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertDoneList();

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/refresh`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('adds a product the engine suggests today that is not yet on the list', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    for (const date of ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']) {
      insertDoneReceiptWithLine(date, milk);
    }
    const listId = insertOpenList();

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/refresh`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      productId: milk,
      name: 'Lettmelk 1 l',
      source: 'suggested',
      reason: 'Kjøpes ca. hver 7. dag, sist for 7 dager siden',
    });
  });

  it('adds nothing a second time once the suggestion is already on the list', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    for (const date of ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']) {
      insertDoneReceiptWithLine(date, milk);
    }
    const listId = insertOpenList();
    await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/refresh`,
      headers: { cookie },
    });

    const second = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/refresh`,
      headers: { cookie },
    });

    expect(second.json().items).toHaveLength(1);
  });

  it('skips a suggested product already on the list even when checked', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    for (const date of ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']) {
      insertDoneReceiptWithLine(date, milk);
    }
    const listId = insertOpenList();
    insertItem(listId, 1, { productId: milk, name: 'Lettmelk 1 l', checked: 1 });

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/refresh`,
      headers: { cookie },
    });

    const items = response.json().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ checked: true });
  });

  it('never re-adds a product dismissed from this list', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    for (const date of ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']) {
      insertDoneReceiptWithLine(date, milk);
    }
    const listId = insertOpenList();
    app.db.insert(shoppingListDismissals).values({ listId, productId: milk, createdAt: NOW }).run();

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/refresh`,
      headers: { cookie },
    });

    expect(response.json().items).toEqual([]);
  });

  it('appends new items after the current maximum position, leaving existing items untouched', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    for (const date of ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']) {
      insertDoneReceiptWithLine(date, milk);
    }
    const listId = insertOpenList();
    insertItem(listId, 5, { name: 'Handlenett' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/refresh`,
      headers: { cookie },
    });

    const items = response.json().items;
    expect(items).toHaveLength(2);
    expect(items.find((item: { name: string }) => item.name === 'Handlenett')).toMatchObject({
      position: 5,
    });
    expect(items.find((item: { name: string }) => item.name === 'Lettmelk 1 l')).toMatchObject({
      position: 6,
    });
  });
});

describe('POST /api/shopping-lists/:id/complete', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'POST', url: '/api/shopping-lists/1/complete' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown list', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists/999/complete',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 409 when already done', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertDoneList();

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/complete`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('sets done and completedAt, after which current is 404 and a new list can be created', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertOpenList();

    const completed = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/complete`,
      headers: { cookie },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ status: 'done', completedAt: NOW });

    const current = await app.inject({
      method: 'GET',
      url: '/api/shopping-lists/current',
      headers: { cookie },
    });
    expect(current.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists',
      headers: { cookie },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().id).not.toBe(listId);
  });
});

describe('POST /api/shopping-lists/:id/proposals', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'POST', url: '/api/shopping-lists/1/proposals' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown list', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists/999/proposals',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 409 when the list is done', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertDoneList();

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it("stores and returns the model's filtered proposal", async () => {
    const llm = new FakeLlmClient([
      proposalCompletion([
        {
          productId: null,
          name: 'Godteri',
          category: 'Snacks',
          quantityText: '1 pose',
          reason: 'Halloween 31. oktober',
          kind: 'merkedag',
        },
      ]),
    ]);
    app = createTestApp({ now: () => new Date(NOW), llmClient: llm });
    cookie = await loginCookie(app);
    const listId = insertOpenList();

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ id: expect.any(Number), createdAt: NOW, model: 'grok-4.6' });
    expect(body.items).toEqual([
      {
        index: 0,
        productId: null,
        name: 'Godteri',
        category: 'Snacks',
        quantityText: '1 pose',
        reason: 'Halloween 31. oktober',
        kind: 'merkedag',
      },
    ]);
    expect(llm.requests[0]).toMatchObject({ purpose: 'propose', listId });
    const stored = app.db
      .select()
      .from(shoppingListProposals)
      .where(eq(shoppingListProposals.listId, listId))
      .get();
    expect(stored).toMatchObject({
      model: 'grok-4.6',
      promptTokens: 500,
      completionTokens: 200,
      acceptedJson: null,
    });
  });

  it('excludes a product with no purchase in the last 26 weeks and passes the recent one flagged onList', async () => {
    const llm = new FakeLlmClient([proposalCompletion([])]);
    app = createTestApp({ now: () => new Date(NOW), llmClient: llm });
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    insertDoneReceiptWithLine('2026-08-28', milk);
    const listId = insertOpenList();
    insertItem(listId, 1, { productId: milk, name: 'Lettmelk 1 l', source: 'suggested' });

    await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals`,
      headers: { cookie },
    });

    const context = JSON.parse(llm.requests[0]?.userText ?? '{}') as {
      products: { id: number; onList: boolean }[];
    };
    expect(context.products).toEqual([expect.objectContaining({ id: milk, onList: true })]);
  });
});

describe('POST /api/shopping-lists/:id/proposals/:proposalId/accept', () => {
  const sevenItems: ShoppingListProposalItem[] = Array.from({ length: 7 }, (_, i) => ({
    index: i,
    productId: null,
    name: `Vare ${i}`,
    category: 'Annet',
    quantityText: null,
    reason: 'Fordi',
    kind: 'vane',
  }));

  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists/1/proposals/1/accept',
      payload: { indexes: [] },
    });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown list', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/shopping-lists/999/proposals/1/accept',
      payload: { indexes: [] },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 404 when the proposal does not belong to the list', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const otherListId = insertOpenList('2026-09-07');
    const proposalId = insertProposal(otherListId, sevenItems);

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals/${proposalId}/accept`,
      payload: { indexes: [] },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 409 when the list is done', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertDoneList();
    const proposalId = insertProposal(listId, sevenItems);

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals/${proposalId}/accept`,
      payload: { indexes: [] },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('adds exactly the accepted three of seven as source "ai" with their reasons, and records the accepted indexes', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const proposalId = insertProposal(listId, sevenItems);

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals/${proposalId}/accept`,
      payload: { indexes: [1, 3, 5] },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items;
    expect(items.map((item: { name: string }) => item.name).sort()).toEqual([
      'Vare 1',
      'Vare 3',
      'Vare 5',
    ]);
    expect(items.every((item: { source: string; reason: string }) => item.source === 'ai')).toBe(
      true,
    );
    expect(items.every((item: { category: string }) => item.category === 'Annet')).toBe(true);
    const stored = app.db
      .select()
      .from(shoppingListProposals)
      .where(eq(shoppingListProposals.id, proposalId))
      .get();
    expect(stored?.acceptedJson).toBe(JSON.stringify([1, 3, 5]));
  });

  it("keeps a productId-null item's own category, so it groups correctly instead of falling under Annet (T37 F2)", async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const proposalId = insertProposal(listId, [
      { ...sevenItems[0]!, name: 'Plommer', category: 'Frukt og grønt' },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals/${proposalId}/accept`,
      payload: { indexes: [0] },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({ name: 'Plommer', category: 'Frukt og grønt', productId: null }),
    ]);
  });

  it('gives 409 on a second accept of the same proposal', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const proposalId = insertProposal(listId, sevenItems);
    await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals/${proposalId}/accept`,
      payload: { indexes: [0] },
      headers: { cookie },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals/${proposalId}/accept`,
      payload: { indexes: [1] },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('records an empty accept ("Avbryt") without adding any item', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const proposalId = insertProposal(listId, sevenItems);

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals/${proposalId}/accept`,
      payload: { indexes: [] },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
    const stored = app.db
      .select()
      .from(shoppingListProposals)
      .where(eq(shoppingListProposals.id, proposalId))
      .get();
    expect(stored?.acceptedJson).toBe('[]');
  });

  it('skips an accepted index whose product is meanwhile already on the list', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    const listId = insertOpenList();
    insertItem(listId, 1, { productId: milk, name: 'Lettmelk 1 l' });
    const proposalId = insertProposal(listId, [
      { ...sevenItems[0]!, productId: milk, name: 'Lettmelk 1 l' },
      sevenItems[1]!,
    ]);

    const response = await app.inject({
      method: 'POST',
      url: `/api/shopping-lists/${listId}/proposals/${proposalId}/accept`,
      payload: { indexes: [0, 1] },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const names = response.json().items.map((item: { name: string }) => item.name);
    expect(names).toEqual(['Lettmelk 1 l', 'Vare 1']);
  });
});
