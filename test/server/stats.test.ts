import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  products,
  receiptLines,
  receipts,
  shoppingListItems,
  shoppingListProposals,
  shoppingLists,
} from '../../src/server/db/schema.ts';
import { createTestApp } from '../helpers/createTestApp.ts';
import { loginCookie } from '../helpers/login.ts';

const NOW = '2026-09-07T12:00:00.000Z';

let app: FastifyInstance | undefined;
let cookie: string;

function insertProduct(
  name: string,
  overrides: Partial<typeof products.$inferInsert> = {},
): number {
  return app!.db
    .insert(products)
    .values({
      name,
      nameNormalized: name.toUpperCase(),
      category: 'Meieri',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertReceipt(overrides: Partial<typeof receipts.$inferInsert> = {}): number {
  return app!.db
    .insert(receipts)
    .values({
      status: 'done',
      warningsJson: '[]',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertLine(receiptId: number, productId: number): void {
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

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/stats/summary', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/stats/summary' });

    expect(response.statusCode).toBe(401);
  });

  it('sums totalOre and counts receipts per month across a three-month fixture, oldest first', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    insertReceipt({ purchasedAt: '2026-07-05', totalOre: 10000 });
    insertReceipt({ purchasedAt: '2026-07-20', totalOre: 5000 });
    insertReceipt({ purchasedAt: '2026-08-12', totalOre: 20000 });
    insertReceipt({ purchasedAt: '2026-09-01', totalOre: 30000 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary?months=3',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().months).toEqual([
      { month: '2026-07', totalOre: 15000, receipts: 2 },
      { month: '2026-08', totalOre: 20000, receipts: 1 },
      { month: '2026-09', totalOre: 30000, receipts: 1 },
    ]);
  });

  it('includes months with no receipts as zero, still in the window', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    insertReceipt({ purchasedAt: '2026-09-01', totalOre: 1000 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary?months=3',
      headers: { cookie },
    });

    expect(response.json().months).toEqual([
      { month: '2026-07', totalOre: 0, receipts: 0 },
      { month: '2026-08', totalOre: 0, receipts: 0 },
      { month: '2026-09', totalOre: 1000, receipts: 1 },
    ]);
  });

  it('excludes a done receipt with no purchasedAt from every month', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    insertReceipt({ purchasedAt: null, totalOre: 99999 });
    insertReceipt({ purchasedAt: '2026-09-01', totalOre: 1000 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary?months=1',
      headers: { cookie },
    });

    expect(response.json().months).toEqual([{ month: '2026-09', totalOre: 1000, receipts: 1 }]);
  });

  it('excludes receipts that are not done', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    insertReceipt({ status: 'uploaded', purchasedAt: null, totalOre: null });
    insertReceipt({ status: 'failed', purchasedAt: '2026-09-01', totalOre: null });
    insertReceipt({ purchasedAt: '2026-09-02', totalOre: 500 });

    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary?months=1',
      headers: { cookie },
    });

    expect(response.json().months).toEqual([{ month: '2026-09', totalOre: 500, receipts: 1 }]);
  });

  it('defaults months to 6', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary',
      headers: { cookie },
    });

    expect(response.json().months).toHaveLength(6);
    expect(response.json().months[5].month).toBe('2026-09');
    expect(response.json().months[0].month).toBe('2026-04');
  });

  it('returns the all-time top 10 products by timesBought, including suppressed ones', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const popular = insertProduct('Lettmelk 1 l');
    for (const date of ['2026-01-05', '2026-02-05', '2026-03-05']) {
      insertLine(insertReceipt({ purchasedAt: date, totalOre: 100 }), popular);
    }
    const suppressed = insertProduct('Havregryn', { suppressed: 1 });
    insertLine(insertReceipt({ purchasedAt: '2026-01-10', totalOre: 100 }), suppressed);
    insertLine(insertReceipt({ purchasedAt: '2026-02-10', totalOre: 100 }), suppressed);
    const rare = insertProduct('Safran');
    insertLine(insertReceipt({ purchasedAt: '2026-01-15', totalOre: 100 }), rare);

    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary?months=1',
      headers: { cookie },
    });

    const topProducts = response.json().topProducts;
    expect(topProducts.map((product: { id: number }) => product.id)).toEqual([
      popular,
      suppressed,
      rare,
    ]);
    expect(topProducts[0]).toMatchObject({ timesBought: 3, suppressed: false });
    expect(topProducts[1]).toMatchObject({ timesBought: 2, suppressed: true });
  });

  it('caps topProducts at 10', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    for (let i = 0; i < 12; i += 1) {
      insertProduct(`Vare ${i}`);
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary?months=1',
      headers: { cookie },
    });

    expect(response.json().topProducts).toHaveLength(10);
  });

  it('counts a group once with its folded stats, leaving both variants out (T40 F2)', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const parent = insertProduct('Skyr mini');
    const jordbaer = insertProduct('Skyr mini jordbær', { parentId: parent });
    const banan = insertProduct('Skyr mini banan', { parentId: parent });
    insertLine(insertReceipt({ purchasedAt: '2026-01-05', totalOre: 100 }), jordbaer);
    insertLine(insertReceipt({ purchasedAt: '2026-01-12', totalOre: 100 }), banan);

    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary?months=1',
      headers: { cookie },
    });

    const topProducts = response.json().topProducts as { id: number }[];
    expect(topProducts.map((product) => product.id)).toEqual([parent]);
    expect(topProducts[0]).toMatchObject({ timesBought: 2, lastBought: '2026-01-12' });
  });

  it('sums proposals, proposed items and accepted items across every proposal (T37)', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const listId = app!.db
      .insert(shoppingLists)
      .values({ weekStart: '2026-09-07', status: 'open', createdAt: NOW })
      .returning()
      .get().id;
    app!.db
      .insert(shoppingListProposals)
      .values({
        listId,
        model: 'grok-4.6',
        promptVersion: 1,
        itemsJson: JSON.stringify([{ index: 0 }, { index: 1 }, { index: 2 }]),
        rawResponse: '{}',
        promptTokens: 100,
        completionTokens: 50,
        durationMs: 1000,
        acceptedJson: JSON.stringify([0, 2]),
        createdAt: NOW,
      })
      .run();
    app!.db
      .insert(shoppingListProposals)
      .values({
        listId,
        model: 'grok-4.6',
        promptVersion: 1,
        itemsJson: JSON.stringify([{ index: 0 }]),
        rawResponse: '{}',
        promptTokens: 100,
        completionTokens: 50,
        durationMs: 1000,
        acceptedJson: null,
        createdAt: NOW,
      })
      .run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary?months=1',
      headers: { cookie },
    });

    expect(response.json().aiProposals).toEqual({
      proposals: 2,
      proposedItems: 4,
      acceptedItems: 2,
      boughtItems: 0,
    });
  });

  it('reports zero aiProposals when none exist', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary?months=1',
      headers: { cookie },
    });

    expect(response.json().aiProposals).toEqual({
      proposals: 0,
      proposedItems: 0,
      acceptedItems: 0,
      boughtItems: 0,
    });
  });

  describe('trips (T39)', () => {
    function insertDoneList(
      weekStart: string,
      overrides: Partial<typeof shoppingLists.$inferInsert> = {},
    ): number {
      return app!.db
        .insert(shoppingLists)
        .values({ weekStart, status: 'done', createdAt: NOW, completedAt: NOW, ...overrides })
        .returning()
        .get().id;
    }

    function insertListItem(
      listId: number,
      position: number,
      overrides: Partial<typeof shoppingListItems.$inferInsert> = {},
    ): void {
      app!.db
        .insert(shoppingListItems)
        .values({
          listId,
          name: `Vare ${position}`,
          source: 'suggested',
          checked: 0,
          position,
          createdAt: NOW,
          ...overrides,
        })
        .run();
    }

    it('sums trip counts across every done list, with a fixture of two lists, one with a receipt', async () => {
      app = createTestApp({ now: () => new Date(NOW) });
      cookie = await loginCookie(app);
      insertDoneList('2026-08-24'); // no receipt linked

      const listB = insertDoneList('2026-08-31');
      const milk = insertProduct('Lettmelk 1 l');
      const bread = insertProduct('Brød');
      const banana = insertProduct('Banan');
      insertListItem(listB, 1, { productId: milk, name: 'Lettmelk 1 l' });
      insertListItem(listB, 2, { productId: bread, name: 'Brød' });
      const receiptId = insertReceipt({ shoppingListId: listB });
      insertLine(receiptId, milk);
      insertLine(receiptId, banana);

      const response = await app.inject({
        method: 'GET',
        url: '/api/stats/summary?months=1',
        headers: { cookie },
      });

      expect(response.json().trips).toEqual({
        completedLists: 2,
        listsWithReceipt: 1,
        plannedItems: 2,
        boughtItems: 1,
        unplannedItems: 1,
      });
    });

    it('shows zero trips with no completed lists', async () => {
      app = createTestApp({ now: () => new Date(NOW) });
      cookie = await loginCookie(app);

      const response = await app.inject({
        method: 'GET',
        url: '/api/stats/summary?months=1',
        headers: { cookie },
      });

      expect(response.json().trips).toEqual({
        completedLists: 0,
        listsWithReceipt: 0,
        plannedItems: 0,
        boughtItems: 0,
        unplannedItems: 0,
      });
    });

    it("sums aiProposals.boughtItems from bought source='ai' items across every list's trip", async () => {
      app = createTestApp({ now: () => new Date(NOW) });
      cookie = await loginCookie(app);
      const listId = insertDoneList('2026-08-31');
      const milk = insertProduct('Lettmelk 1 l');
      insertListItem(listId, 1, { productId: milk, name: 'Lettmelk 1 l', source: 'ai' });
      const receiptId = insertReceipt({ shoppingListId: listId });
      insertLine(receiptId, milk);

      const response = await app.inject({
        method: 'GET',
        url: '/api/stats/summary?months=1',
        headers: { cookie },
      });

      expect(response.json().aiProposals.boughtItems).toBe(1);
    });
  });
});
