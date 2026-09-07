import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  products,
  receiptLines,
  receipts,
  shoppingListItems,
  shoppingLists,
} from '../../src/server/db/schema.ts';
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
    expect(response.json()).toMatchObject({ name: 'Ost', source: 'manual', position: 3 });
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

  it('updates checked, name, quantityText and position', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const listId = insertOpenList();
    const itemId = insertItem(listId, 1);

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
