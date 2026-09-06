import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { receipts } from '../../src/server/db/schema.ts';
import { FakeLlmClient } from '../../src/server/llm/FakeLlmClient.ts';
import type { LlmClient } from '../../src/server/llm/LlmClient.ts';
import { createTestApp } from '../helpers/createTestApp.ts';
import { loginCookie } from '../helpers/login.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', 'fixtures', 'images');

async function readFixture(name: string): Promise<Buffer> {
  return readFile(path.join(fixturesDir, name));
}

function multipartForm(bytes: Buffer, filename: string, type: string): FormData {
  const form = new FormData();
  form.set('image', new Blob([bytes], { type }), filename);
  return form;
}

function fakeSuccess(overrides: Record<string, unknown> = {}) {
  return {
    text: JSON.stringify({
      storeName: 'REMA 1000 Grünerløkka',
      purchasedAt: '2026-09-03',
      total: 43.8,
      lines: [
        {
          text: 'TINE LETTMELK 1L',
          kind: 'item',
          quantity: 2,
          unit: 'stk',
          unitPrice: 21.9,
          totalPrice: 43.8,
        },
      ],
      ...overrides,
    }),
    finishReason: 'stop',
    model: 'kimi-k2.6',
    usage: { promptTokens: 10, completionTokens: 5 },
    durationMs: 5,
  };
}

function fakeMatch(overrides: Record<string, unknown> = {}) {
  return {
    text: JSON.stringify({
      matches: [
        {
          text: 'TINE LETTMELK 1L',
          existingProduct: null,
          newProductName: 'Lettmelk 1 l',
          category: 'Meieri',
        },
      ],
      ...overrides,
    }),
    finishReason: 'stop',
    model: 'kimi-k2.6',
    usage: { promptTokens: 10, completionTokens: 5 },
    durationMs: 5,
  };
}

async function uploadReceipt(app: FastifyInstance, cookie: string): Promise<number> {
  const bytes = await readFixture('receipt-small.jpg');
  const response = await app.inject({
    method: 'POST',
    url: '/api/receipts',
    payload: multipartForm(bytes, 'receipt-small.jpg', 'image/jpeg'),
    headers: { cookie },
  });
  return response.json().id;
}

async function scanReceipt(app: FastifyInstance, cookie: string, id: number) {
  return app.inject({ method: 'POST', url: `/api/receipts/${id}/scan`, headers: { cookie } });
}

async function uploadAndScan(app: FastifyInstance, cookie: string): Promise<number> {
  const id = await uploadReceipt(app, cookie);
  await scanReceipt(app, cookie, id);
  return id;
}

let app: FastifyInstance | undefined;
let tmpDir: string | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe('POST /api/receipts', () => {
  it('replies 201 with the id, stores it as uploaded, and does not enqueue processing', async () => {
    const hangingLlm: LlmClient = { completeJson: () => new Promise(() => {}) };
    app = createTestApp({ llmClient: hangingLlm });
    const cookie = await loginCookie(app);

    const bytes = await readFixture('receipt-small.jpg');
    const response = await app.inject({
      method: 'POST',
      url: '/api/receipts',
      payload: multipartForm(bytes, 'receipt-small.jpg', 'image/jpeg'),
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const id = response.json().id;

    const stored = app.db.select().from(receipts).where(eq(receipts.id, id)).get();
    expect(stored?.status).toBe('uploaded');
    expect(app.receiptProcessor.queueLength()).toBe(0);
  });
});

describe('GET /api/receipts/:id', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/receipts/1' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown id', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/receipts/999',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns the done receipt with its lines, unmatched products and imageUrl', async () => {
    app = createTestApp({ llmClient: new FakeLlmClient([fakeSuccess()]) });
    const cookie = await loginCookie(app);

    const id = await uploadAndScan(app, cookie);
    await app.receiptProcessor.drain();

    const response = await app.inject({
      method: 'GET',
      url: `/api/receipts/${id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('done');
    expect(body.storeName).toBe('REMA 1000 Grünerløkka');
    expect(body.totalOre).toBe(4380);
    expect(body.lineCount).toBe(1);
    expect(body.imageUrl).toBe(`/api/receipts/${id}/image`);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({
      rawText: 'TINE LETTMELK 1L',
      totalOre: 4380,
      product: null,
      matchSource: null,
    });
  });
});

describe('POST /api/receipts/:id/scan', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'POST', url: '/api/receipts/1/scan' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown id', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);

    const response = await scanReceipt(app, cookie, 999);

    expect(response.statusCode).toBe(404);
  });

  it('moves an uploaded receipt to pending and enqueues it', async () => {
    app = createTestApp({ llmClient: new FakeLlmClient([fakeSuccess()]) });
    const cookie = await loginCookie(app);
    const id = await uploadReceipt(app, cookie);

    const response = await scanReceipt(app, cookie, id);

    expect(response.statusCode).toBe(202);
    expect(response.json().status).not.toBe('uploaded');
    await app.receiptProcessor.drain();
    const final = await app.inject({
      method: 'GET',
      url: `/api/receipts/${id}`,
      headers: { cookie },
    });
    expect(final.json().status).toBe('done');
  });

  it('gives 409 for a receipt that is done', async () => {
    app = createTestApp({ llmClient: new FakeLlmClient([fakeSuccess()]) });
    const cookie = await loginCookie(app);
    const id = await uploadAndScan(app, cookie);
    await app.receiptProcessor.drain();

    const response = await scanReceipt(app, cookie, id);

    expect(response.statusCode).toBe(409);
  });

  it('gives 409 for a receipt that is currently processing', async () => {
    const hangingLlm: LlmClient = { completeJson: () => new Promise(() => {}) };
    app = createTestApp({ llmClient: hangingLlm });
    const cookie = await loginCookie(app);
    const id = await uploadAndScan(app, cookie);

    const response = await scanReceipt(app, cookie, id);

    expect(response.statusCode).toBe(409);
  });

  it('moves a failed receipt to pending, clears the error and reprocesses it to done', async () => {
    app = createTestApp({
      llmClient: new FakeLlmClient([
        () => {
          throw new Error('boom');
        },
        fakeSuccess(),
      ]),
    });
    const cookie = await loginCookie(app);

    const id = await uploadAndScan(app, cookie);
    await app.receiptProcessor.drain();
    expect(
      (await app.inject({ method: 'GET', url: `/api/receipts/${id}`, headers: { cookie } })).json()
        .status,
    ).toBe('failed');

    const scanResponse = await scanReceipt(app, cookie, id);
    expect(scanResponse.statusCode).toBe(202);
    expect(scanResponse.json().errorMessage).toBeNull();

    await app.receiptProcessor.drain();
    const final = await app.inject({
      method: 'GET',
      url: `/api/receipts/${id}`,
      headers: { cookie },
    });
    expect(final.json().status).toBe('done');
  });
});

describe('POST /api/receipts/:id/rematch', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'POST', url: '/api/receipts/1/rematch' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an unknown id', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/receipts/999/rematch',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('re-matches an unmatched line, clears MATCHING_FAILED and keeps an unrelated warning', async () => {
    app = createTestApp({
      llmClient: new FakeLlmClient([
        fakeSuccess({ storeName: null }),
        () => {
          throw new Error('matching backend down');
        },
        fakeMatch(),
      ]),
    });
    const cookie = await loginCookie(app);

    const id = await uploadAndScan(app, cookie);
    await app.receiptProcessor.drain();

    const afterProcessing = await app.inject({
      method: 'GET',
      url: `/api/receipts/${id}`,
      headers: { cookie },
    });
    expect(afterProcessing.json().status).toBe('done');
    expect(afterProcessing.json().warnings).toEqual(
      expect.arrayContaining(['MISSING_STORE', 'MATCHING_FAILED']),
    );
    expect(afterProcessing.json().lines[0]).toMatchObject({ product: null, matchSource: null });

    const rematchResponse = await app.inject({
      method: 'POST',
      url: `/api/receipts/${id}/rematch`,
      headers: { cookie },
    });

    expect(rematchResponse.statusCode).toBe(200);
    const body = rematchResponse.json();
    expect(body.warnings).not.toContain('MATCHING_FAILED');
    expect(body.warnings).toContain('MISSING_STORE');
    expect(body.lines[0]).toMatchObject({ matchSource: 'llm' });
    expect(body.lines[0].product).toMatchObject({ name: 'Lettmelk 1 l' });
  });
});

describe('GET /api/health', () => {
  it('reports the real queue length', async () => {
    const hangingLlm: LlmClient = { completeJson: () => new Promise(() => {}) };
    app = createTestApp({ llmClient: hangingLlm });
    const cookie = await loginCookie(app);

    const idle = await app.inject({ method: 'GET', url: '/api/health' });
    expect(idle.json().queueLength).toBe(0);

    await uploadAndScan(app, cookie);

    const busy = await app.inject({ method: 'GET', url: '/api/health' });
    expect(busy.json().queueLength).toBe(1);
  });
});

describe('crash recovery', () => {
  it('finishes a receipt left in "processing" after a restart', async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'kvitteringer-'));
    const databasePath = path.join(tmpDir, 'receipt-scanner.db');

    const hangingLlm: LlmClient = { completeJson: () => new Promise(() => {}) };
    app = createTestApp({ databasePath, llmClient: hangingLlm });
    const cookie = await loginCookie(app);
    const id = await uploadAndScan(app, cookie);

    const stuck = app.db.select().from(receipts).where(eq(receipts.id, id)).get();
    expect(stuck?.status).toBe('processing');

    await app.close();

    app = createTestApp({ databasePath, llmClient: new FakeLlmClient([fakeSuccess()]) });
    await app.receiptProcessor.drain();

    const finished = app.db.select().from(receipts).where(eq(receipts.id, id)).get();
    expect(finished?.status).toBe('done');
  });

  it('does not scan an uploaded receipt on restart', async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'kvitteringer-'));
    const databasePath = path.join(tmpDir, 'receipt-scanner.db');

    app = createTestApp({ databasePath, llmClient: new FakeLlmClient([]) });
    const cookie = await loginCookie(app);
    const id = await uploadReceipt(app, cookie);

    await app.close();

    app = createTestApp({ databasePath, llmClient: new FakeLlmClient([]) });
    await app.receiptProcessor.drain();

    const stillUploaded = app.db.select().from(receipts).where(eq(receipts.id, id)).get();
    expect(stillUploaded?.status).toBe('uploaded');
    expect(app.receiptProcessor.queueLength()).toBe(0);
  });
});
