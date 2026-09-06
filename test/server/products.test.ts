import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { productAliases, products, receiptLines, receipts } from '../../src/server/db/schema.ts';
import { normalizeText } from '../../src/shared/normalize.ts';
import { createTestApp } from '../helpers/createTestApp.ts';
import { loginCookie } from '../helpers/login.ts';

const NOW = '2026-09-03T12:00:00.000Z';

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
      nameNormalized: normalizeText(name),
      category: 'Meieri',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertReceipt(
  purchasedAt: string,
  overrides: Partial<typeof receipts.$inferInsert> = {},
): number {
  return app!.db
    .insert(receipts)
    .values({
      status: 'done',
      purchasedAt,
      totalOre: 100,
      warningsJson: '[]',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertLine(
  receiptId: number,
  productId: number | null,
  overrides: Partial<typeof receiptLines.$inferInsert> = {},
): number {
  return app!.db
    .insert(receiptLines)
    .values({
      receiptId,
      lineNo: 1,
      kind: 'item',
      rawText: 'line',
      totalOre: 100,
      productId,
      createdAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertAlias(
  aliasNormalized: string,
  productId: number,
  source: 'llm' | 'user' = 'user',
): number {
  return app!.db
    .insert(productAliases)
    .values({ aliasNormalized, productId, source, createdAt: NOW })
    .returning()
    .get().id;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/products', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/products' });

    expect(response.statusCode).toBe(401);
  });

  it('matches a hand-computed fixture: three receipts, two products, ordered by timesBought desc', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const milk = insertProduct('Lettmelk 1 l');
    const oats = insertProduct('Havregryn 1 kg');
    const r1 = insertReceipt('2026-08-01');
    insertLine(r1, milk);
    insertLine(r1, oats);
    const r2 = insertReceipt('2026-08-08');
    insertLine(r2, milk);
    const r3 = insertReceipt('2026-08-22');
    insertLine(r3, milk);

    const response = await app.inject({ method: 'GET', url: '/api/products', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.map((p: { id: number }) => p.id)).toEqual([milk, oats]);
    expect(body[0]).toMatchObject({
      id: milk,
      timesBought: 3,
      lastBought: '2026-08-22',
      medianIntervalDays: 10.5,
    });
    expect(body[1]).toMatchObject({ id: oats, timesBought: 1, medianIntervalDays: null });
  });

  it('filters case- and punctuation-insensitively with q', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    insertProduct('TINE Lettmelk, 1l');
    insertProduct('Havregryn 1 kg');

    const response = await app.inject({
      method: 'GET',
      url: `/api/products?${new URLSearchParams({ q: 'lettmelk 1l' }).toString()}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('TINE Lettmelk, 1l');
  });

  it('excludes suppressed products by default, with includeSuppressed=false, and includes them with includeSuppressed=true', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    insertProduct('Vanlig produkt');
    insertProduct('Skjult produkt', { suppressed: 1 });

    const byDefault = await app.inject({
      method: 'GET',
      url: '/api/products',
      headers: { cookie },
    });
    expect(byDefault.json()).toHaveLength(1);

    const explicitFalse = await app.inject({
      method: 'GET',
      url: '/api/products?includeSuppressed=false',
      headers: { cookie },
    });
    expect(explicitFalse.json()).toHaveLength(1);

    const withSuppressed = await app.inject({
      method: 'GET',
      url: '/api/products?includeSuppressed=true',
      headers: { cookie },
    });
    expect(withSuppressed.json()).toHaveLength(2);
  });

  it('gives 400 for an invalid includeSuppressed value', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/products?includeSuppressed=maybe',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it('runs at most two SQL statements to list products with purchases', async () => {
    const statements: string[] = [];
    app = createTestApp({ dbVerbose: (message) => statements.push(String(message)) });
    cookie = await loginCookie(app);
    for (let i = 0; i < 10; i += 1) {
      const productId = insertProduct(`Produkt ${i}`);
      const receiptId = insertReceipt('2026-08-01');
      insertLine(receiptId, productId);
    }

    statements.length = 0;
    const response = await app.inject({ method: 'GET', url: '/api/products', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(statements.length).toBeLessThanOrEqual(2);
  });
});

describe('GET /api/products/:id', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/products/1' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown id', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/products/999',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns aliases and purchases newest first, excluding non-done receipts and non-item lines', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const productId = insertProduct('Lettmelk 1 l');
    insertAlias('TINE LETTMELK 1L', productId, 'llm');
    const r1 = insertReceipt('2026-08-01', { storeName: 'KIWI' });
    insertLine(r1, productId, { quantity: 1 });
    const r2 = insertReceipt('2026-08-15', { storeName: 'REMA' });
    insertLine(r2, productId, { quantity: 2 });
    const pending = insertReceipt('2026-08-20', { status: 'pending' });
    insertLine(pending, productId);
    insertLine(r2, productId, { kind: 'discount', totalOre: -50 });

    const response = await app.inject({
      method: 'GET',
      url: `/api/products/${productId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.aliases).toEqual([
      { id: expect.any(Number), alias: 'TINE LETTMELK 1L', source: 'llm' },
    ]);
    expect(body.purchases).toEqual([
      {
        receiptId: r2,
        date: '2026-08-15',
        storeName: 'REMA',
        quantity: 2,
        unit: null,
        totalOre: 100,
      },
      {
        receiptId: r1,
        date: '2026-08-01',
        storeName: 'KIWI',
        quantity: 1,
        unit: null,
        totalOre: 100,
      },
    ]);
  });
});

describe('POST /api/products', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'POST', url: '/api/products', payload: {} });

    expect(response.statusCode).toBe(401);
  });

  it('creates a product, defaulting category to Annet', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { name: 'Ny vare' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: 'Ny vare',
      category: 'Annet',
      suppressed: false,
    });
  });

  it('gives 409 for a duplicate normalized name', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    insertProduct('Lettmelk 1 l');

    const response = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { name: 'lettmelk, 1 L' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('PATCH /api/products/:id', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'PATCH', url: '/api/products/1', payload: {} });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown id', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/products/999',
      payload: { name: 'x' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('updates name, category and suppressed', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const id = insertProduct('Lettmelk 1 l');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/products/${id}`,
      payload: { name: 'Lettmelk 1L', category: 'Drikke', suppressed: true },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'Lettmelk 1L',
      category: 'Drikke',
      suppressed: true,
    });
  });

  it('gives 409 when renaming to an existing normalized name', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    insertProduct('Lettmelk 1 l');
    const other = insertProduct('Havregryn 1 kg');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/products/${other}`,
      payload: { name: 'lettmelk 1 L' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('gives 400 for an unknown field', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const id = insertProduct('Lettmelk 1 l');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/products/${id}`,
      payload: { nope: true },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/products/:id/merge', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/products/1/merge',
      payload: { intoProductId: 2 },
    });

    expect(response.statusCode).toBe(401);
  });

  it('moves lines and aliases to the target, deletes the source, and a later receipt with the source name maps to the target', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const source = insertProduct('COOP Lettmelk');
    const target = insertProduct('TINE Lettmelk 1 l');
    const r1 = insertReceipt('2026-08-01');
    insertLine(r1, source);

    const response = await app.inject({
      method: 'POST',
      url: `/api/products/${source}/merge`,
      payload: { intoProductId: target },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: target, timesBought: 1 });

    expect(app.db.select().from(products).where(eq(products.id, source)).get()).toBeUndefined();
    expect(
      app.db.select().from(receiptLines).where(eq(receiptLines.receiptId, r1)).get()?.productId,
    ).toBe(target);
    const alias = app.db
      .select()
      .from(productAliases)
      .where(eq(productAliases.aliasNormalized, 'COOP LETTMELK'))
      .get();
    expect(alias?.productId).toBe(target);
  });

  it('gives 400 when the ids are equal', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const id = insertProduct('Lettmelk 1 l');

    const response = await app.inject({
      method: 'POST',
      url: `/api/products/${id}/merge`,
      payload: { intoProductId: id },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it('gives 404 when the target is missing', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const id = insertProduct('Lettmelk 1 l');

    const response = await app.inject({
      method: 'POST',
      url: `/api/products/${id}/merge`,
      payload: { intoProductId: 999 },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /api/product-aliases/:id', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'DELETE', url: '/api/product-aliases/1' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown id', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/product-aliases/999',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('deletes the alias but leaves the line pointing at its product', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const productId = insertProduct('Lettmelk 1 l');
    const aliasId = insertAlias('TINE LETTMELK 1L', productId);
    const r1 = insertReceipt('2026-08-01');
    const lineId = insertLine(r1, productId);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/product-aliases/${aliasId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(204);
    expect(
      app.db.select().from(productAliases).where(eq(productAliases.id, aliasId)).get(),
    ).toBeUndefined();
    expect(
      app.db.select().from(receiptLines).where(eq(receiptLines.id, lineId)).get()?.productId,
    ).toBe(productId);
  });
});
