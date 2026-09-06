import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { receiptImages, receiptLines, receipts } from '../../src/server/db/schema.ts';
import { createTestApp } from '../helpers/createTestApp.ts';
import { loginCookie } from '../helpers/login.ts';

const NOW = '2026-09-03T12:00:00.000Z';

let app: FastifyInstance | undefined;
let cookie: string;

function insertDoneReceipt(overrides: Partial<typeof receipts.$inferInsert> = {}): number {
  return app!.db
    .insert(receipts)
    .values({
      status: 'done',
      storeName: 'REMA 1000 Grünerløkka',
      purchasedAt: '2026-09-03',
      totalOre: 10000,
      warningsJson: '[]',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertItemLine(
  receiptId: number,
  totalOre = 10000,
  overrides: Partial<typeof receiptLines.$inferInsert> = {},
) {
  return app!.db
    .insert(receiptLines)
    .values({
      receiptId,
      lineNo: 1,
      kind: 'item',
      rawText: 'TINE LETTMELK 1L',
      totalOre,
      createdAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertImage(receiptId: number, sha256: string) {
  app!.db
    .insert(receiptImages)
    .values({
      receiptId,
      mimeType: 'image/jpeg',
      bytes: Buffer.from(`img-${receiptId}`),
      width: 10,
      height: 10,
      sha256,
    })
    .run();
}

function getReceipt(id: number) {
  return app!.db.select().from(receipts).where(eq(receipts.id, id)).get();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/receipts', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/receipts' });

    expect(response.statusCode).toBe(401);
  });

  it('returns disjoint pages, newest first, with lineCount and warnings', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const ids = Array.from({ length: 5 }, (_, i) => insertDoneReceipt({ storeName: `Store ${i}` }));
    insertItemLine(ids[2]!);
    insertItemLine(ids[2]!, 10000, { lineNo: 2, rawText: 'BANAN' });

    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/receipts?limit=3',
      headers: { cookie },
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json();
    expect(firstBody.map((r: { id: number }) => r.id)).toEqual([ids[4], ids[3], ids[2]]);
    const withLines = firstBody.find((r: { id: number }) => r.id === ids[2]);
    expect(withLines.lineCount).toBe(2);
    expect(firstBody.find((r: { id: number }) => r.id === ids[4]).lineCount).toBe(0);

    const secondPage = await app.inject({
      method: 'GET',
      url: `/api/receipts?limit=3&before=${ids[2]}`,
      headers: { cookie },
    });
    const secondIds = secondPage.json().map((r: { id: number }) => r.id);
    expect(secondIds).toEqual([ids[1], ids[0]]);

    const allSeen = [...firstBody.map((r: { id: number }) => r.id), ...secondIds];
    expect(new Set(allSeen).size).toBe(allSeen.length);
  });

  it('rejects a limit outside 1-100', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const tooLarge = await app.inject({
      method: 'GET',
      url: '/api/receipts?limit=101',
      headers: { cookie },
    });
    const tooSmall = await app.inject({
      method: 'GET',
      url: '/api/receipts?limit=0',
      headers: { cookie },
    });

    expect(tooLarge.statusCode).toBe(400);
    expect(tooSmall.statusCode).toBe(400);
  });
});

describe('PATCH /api/receipts/:id', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'PATCH', url: '/api/receipts/1', payload: {} });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown id', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/receipts/999',
      payload: {},
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('gives 409 for a receipt that is not done', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const id = insertDoneReceipt({ status: 'pending' });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { reviewed: true },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
  });

  it('gives 400 for an unknown field or a malformed date', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const id = insertDoneReceipt();

    const unknownField = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { nope: true },
      headers: { cookie },
    });
    const badDate = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { purchasedAt: 'not-a-date' },
      headers: { cookie },
    });

    expect(unknownField.statusCode).toBe(400);
    expect(badDate.statusCode).toBe(400);
  });

  it('sets reviewedAt when reviewed is true', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const id = insertDoneReceipt();
    insertItemLine(id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { reviewed: true },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reviewedAt).not.toBeNull();
  });

  it('adds TOTAL_MISMATCH when patched to a mismatching total, and removes it when patched back', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const id = insertDoneReceipt({ totalOre: 10000 });
    insertItemLine(id, 10000);

    const mismatched = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { totalOre: 50000 },
      headers: { cookie },
    });
    expect(mismatched.json().warnings).toContain('TOTAL_MISMATCH');

    const fixed = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { totalOre: 10000 },
      headers: { cookie },
    });
    expect(fixed.json().warnings).not.toContain('TOTAL_MISMATCH');
  });

  it('adds POSSIBLE_DUPLICATE when patched to match another done receipt, and removes it when the total changes again', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const original = insertDoneReceipt({
      storeName: 'KIWI Torshov',
      purchasedAt: '2026-09-01',
      totalOre: 20000,
    });
    insertItemLine(original, 20000);
    const id = insertDoneReceipt({
      storeName: 'Somewhere Else',
      purchasedAt: '2026-09-05',
      totalOre: 15000,
    });
    insertItemLine(id, 15000);

    const duplicated = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { storeName: 'KIWI Torshov', purchasedAt: '2026-09-01', totalOre: 20000 },
      headers: { cookie },
    });
    expect(duplicated.json().warnings).toContain('POSSIBLE_DUPLICATE');
    expect(duplicated.json().possibleDuplicateOf).toBe(original);

    const changedAgain = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { totalOre: 30000 },
      headers: { cookie },
    });
    expect(changedAgain.json().warnings).not.toContain('POSSIBLE_DUPLICATE');
    expect(changedAgain.json().possibleDuplicateOf).toBeNull();
  });

  it('drops MISSING_STORE once a store name is patched in, but keeps it when patched to null', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const withStore = insertDoneReceipt({ storeName: null, warningsJson: '["MISSING_STORE"]' });
    insertItemLine(withStore);
    const staysNull = insertDoneReceipt({ storeName: null, warningsJson: '["MISSING_STORE"]' });
    insertItemLine(staysNull);

    const fixed = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${withStore}`,
      payload: { storeName: 'REMA 1000 Grünerløkka' },
      headers: { cookie },
    });
    expect(fixed.json().warnings).not.toContain('MISSING_STORE');

    const keptNull = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${staysNull}`,
      payload: { storeName: null },
      headers: { cookie },
    });
    expect(keptNull.json().warnings).toContain('MISSING_STORE');
  });

  it('drops MISSING_DATE for a past date, adds FUTURE_DATE for a future one, and drops it again for today', async () => {
    app = createTestApp({ now: () => new Date(NOW) });
    cookie = await loginCookie(app);
    const id = insertDoneReceipt({ purchasedAt: '2026-01-01', warningsJson: '["MISSING_DATE"]' });
    insertItemLine(id);

    const pastDate = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { purchasedAt: '2026-09-01' },
      headers: { cookie },
    });
    expect(pastDate.json().warnings).not.toContain('MISSING_DATE');
    expect(pastDate.json().warnings).not.toContain('FUTURE_DATE');

    const futureDate = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { purchasedAt: '2026-09-10' },
      headers: { cookie },
    });
    expect(futureDate.json().warnings).toContain('FUTURE_DATE');

    const backToToday = await app.inject({
      method: 'PATCH',
      url: `/api/receipts/${id}`,
      payload: { purchasedAt: '2026-09-03' },
      headers: { cookie },
    });
    expect(backToToday.json().warnings).not.toContain('FUTURE_DATE');
  });
});

describe('DELETE /api/receipts/:id', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'DELETE', url: '/api/receipts/1' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown id', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/receipts/999',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('deletes the receipt and cascades its image and lines', async () => {
    app = createTestApp();
    cookie = await loginCookie(app);
    const id = insertDoneReceipt();
    insertItemLine(id);
    insertImage(id, 'b'.repeat(64));

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/receipts/${id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(204);
    expect(getReceipt(id)).toBeUndefined();
    expect(
      app.db.select().from(receiptLines).where(eq(receiptLines.receiptId, id)).all(),
    ).toHaveLength(0);
    expect(
      app.db.select().from(receiptImages).where(eq(receiptImages.receiptId, id)).all(),
    ).toHaveLength(0);
  });
});
