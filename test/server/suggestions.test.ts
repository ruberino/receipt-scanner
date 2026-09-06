import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { products, receiptLines, receipts } from '../../src/server/db/schema.ts';
import { createTestApp } from '../helpers/createTestApp.ts';
import { loginCookie } from '../helpers/login.ts';

const NOW = '2026-09-04T12:00:00.000Z';

let app: FastifyInstance | undefined;

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

function insertReceipt(purchasedAt: string): number {
  return app!.db
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

describe('GET /api/suggestions', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/suggestions' });

    expect(response.statusCode).toBe(401);
  });

  it('suggests a weekly product using loadProductHistories and the injected clock', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    const cookie = await loginCookie(app);
    const productId = insertProduct('Lettmelk 1 l');
    for (const date of ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']) {
      insertLine(insertReceipt(date), productId);
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/suggestions',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        productId,
        name: 'Lettmelk 1 l',
        reason: 'Kjøpes ca. hver 7. dag, sist for 7 dager siden',
        score: 1,
      }),
    ]);
  });
});
