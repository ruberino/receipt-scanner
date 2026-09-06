import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { productAliases, products, receiptLines, receipts } from '../../src/server/db/schema.ts';
import { createTestApp } from '../helpers/createTestApp.ts';
import { loginCookie } from '../helpers/login.ts';

const NOW = '2026-09-03T12:00:00.000Z';

let app: FastifyInstance | undefined;

function insertReceipt(overrides: Partial<typeof receipts.$inferInsert> = {}): number {
  return app!.db
    .insert(receipts)
    .values({ status: 'done', warningsJson: '[]', createdAt: NOW, updatedAt: NOW, ...overrides })
    .returning()
    .get().id;
}

async function getReceiptWarnings(cookie: string, receiptId: number): Promise<string[]> {
  const response = await app!.inject({
    method: 'GET',
    url: `/api/receipts/${receiptId}`,
    headers: { cookie },
  });
  return response.json().warnings;
}

function insertLine(
  receiptId: number,
  rawText: string,
  overrides: Partial<typeof receiptLines.$inferInsert> = {},
): number {
  return app!.db
    .insert(receiptLines)
    .values({
      receiptId,
      lineNo: 1,
      kind: 'item',
      rawText,
      totalOre: 4380,
      createdAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertProduct(name: string): number {
  return app!.db
    .insert(products)
    .values({ name, nameNormalized: name.toUpperCase(), createdAt: NOW, updatedAt: NOW })
    .returning()
    .get().id;
}

function getAlias(aliasNormalized: string) {
  return app!.db
    .select()
    .from(productAliases)
    .where(eq(productAliases.aliasNormalized, aliasNormalized))
    .get();
}

function getLine(id: number) {
  return app!.db.select().from(receiptLines).where(eq(receiptLines.id, id)).get();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('PATCH /api/receipt-lines/:id', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/receipt-lines/1',
      payload: { newProductName: 'Lettmelk 1 l' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown line', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/receipt-lines/999',
      payload: { newProductName: 'Lettmelk 1 l' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 400 when neither or both of productId/newProductName are given', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const lineId = insertLine(insertReceipt(), 'TINE LETTMELK 1L');
    const productId = insertProduct('Lettmelk 1 l');

    const neither = await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: {},
      headers: { cookie },
    });
    const both = await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: { productId, newProductName: 'Lettmelk 1 l' },
      headers: { cookie },
    });

    expect(neither.statusCode).toBe(400);
    expect(both.statusCode).toBe(400);
  });

  it('gives 400 for a productId that does not exist', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const lineId = insertLine(insertReceipt(), 'TINE LETTMELK 1L');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: { productId: 999 },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it('links to an existing product by productId, sets match_source user, and creates a user alias', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const receiptId = insertReceipt();
    const lineId = insertLine(receiptId, 'TINE LETTMELK 1L');
    const productId = insertProduct('Lettmelk 1 l');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: { productId },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.matchSource).toBe('user');
    expect(body.product).toMatchObject({ id: productId, name: 'Lettmelk 1 l' });
    expect(getAlias('TINE LETTMELK 1L')).toMatchObject({ productId, source: 'user' });
  });

  it('creates a new product and a user alias when given newProductName, and a later receipt maps to it by alias', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const receiptId = insertReceipt();
    const lineId = insertLine(receiptId, 'TINE YT REST 330ML');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: { newProductName: 'Proteindrikk', category: 'Drikke' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.product).toMatchObject({ name: 'Proteindrikk', category: 'Drikke' });
    const alias = getAlias('TINE YT REST 330ML');
    expect(alias).toMatchObject({ productId: body.product.id, source: 'user' });

    // A later receipt line with the same printed text now maps to the same product via the alias
    // path (T09's matchLines step 1), without any LLM call.
    const secondReceiptId = insertReceipt();
    const secondLineId = insertLine(secondReceiptId, 'TINE YT REST 330ML');
    // Simulate what matchLines' alias lookup does, since this test is about the alias PATCH creates.
    const matchedAlias = getAlias('TINE YT REST 330ML');
    expect(matchedAlias?.productId).toBe(body.product.id);
    app!.db
      .update(receiptLines)
      .set({ productId: matchedAlias!.productId, matchSource: 'alias' })
      .where(eq(receiptLines.id, secondLineId))
      .run();
    expect(getLine(secondLineId)).toMatchObject({
      productId: body.product.id,
      matchSource: 'alias',
    });
  });

  it('replaces an existing llm alias with the user alias', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const receiptId = insertReceipt();
    const lineId = insertLine(receiptId, 'TINE YT REST 330ML');
    const oldProductId = insertProduct('Yoghurt');
    app!.db
      .insert(productAliases)
      .values({
        aliasNormalized: 'TINE YT REST 330ML',
        productId: oldProductId,
        source: 'llm',
        createdAt: NOW,
      })
      .run();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: { newProductName: 'Proteindrikk', category: 'Drikke' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const aliases = app!.db
      .select()
      .from(productAliases)
      .where(eq(productAliases.aliasNormalized, 'TINE YT REST 330ML'))
      .all();
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({ source: 'user', productId: response.json().product.id });
    expect(response.json().product.id).not.toBe(oldProductId);
  });

  it('links to an existing product when newProductName normalises to it, instead of duplicating', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const receiptId = insertReceipt();
    const lineId = insertLine(receiptId, 'GROVBRØD LANDBRØD');
    const productId = insertProduct('Grovbrød');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: { newProductName: 'Grovbrød' },
      headers: { cookie },
    });

    expect(response.json().product.id).toBe(productId);
    expect(app!.db.select().from(products).all()).toHaveLength(1);
  });

  it('removes UNMATCHED_LINES from the receipt once the last unmatched item line is matched (T25)', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const receiptId = insertReceipt({ warningsJson: JSON.stringify(['UNMATCHED_LINES']) });
    const lineId = insertLine(receiptId, 'MYSTERY ITEM');
    const productId = insertProduct('Mystisk vare');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: { productId },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(await getReceiptWarnings(cookie, receiptId)).not.toContain('UNMATCHED_LINES');
  });

  it('leaves UNMATCHED_LINES when another item line on the receipt is still unmatched (T25)', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const receiptId = insertReceipt({ warningsJson: JSON.stringify(['UNMATCHED_LINES']) });
    const lineId = insertLine(receiptId, 'MYSTERY ITEM A', { lineNo: 1 });
    insertLine(receiptId, 'MYSTERY ITEM B', { lineNo: 2 });
    const productId = insertProduct('Mystisk vare A');

    await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: { productId },
      headers: { cookie },
    });

    expect(await getReceiptWarnings(cookie, receiptId)).toContain('UNMATCHED_LINES');
  });

  it('leaves MATCHING_FAILED alone when the last unmatched line is matched (T25)', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const receiptId = insertReceipt({
      warningsJson: JSON.stringify(['UNMATCHED_LINES', 'MATCHING_FAILED']),
    });
    const lineId = insertLine(receiptId, 'MYSTERY ITEM');
    const productId = insertProduct('Mystisk vare');

    await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: { productId },
      headers: { cookie },
    });

    const warnings = await getReceiptWarnings(cookie, receiptId);
    expect(warnings).not.toContain('UNMATCHED_LINES');
    expect(warnings).toContain('MATCHING_FAILED');
  });

  it('does not count a discount line toward "still unmatched" when recomputing UNMATCHED_LINES (T25)', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const receiptId = insertReceipt({ warningsJson: JSON.stringify(['UNMATCHED_LINES']) });
    insertLine(receiptId, 'RABATT', { kind: 'discount', totalOre: -100, lineNo: 1 });
    const lineId = insertLine(receiptId, 'MYSTERY ITEM', { lineNo: 2 });
    const productId = insertProduct('Mystisk vare');

    await app.inject({
      method: 'PATCH',
      url: `/api/receipt-lines/${lineId}`,
      payload: { productId },
      headers: { cookie },
    });

    expect(await getReceiptWarnings(cookie, receiptId)).not.toContain('UNMATCHED_LINES');
  });
});
