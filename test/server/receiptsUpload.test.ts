import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
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

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST /api/receipts', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();
    const bytes = await readFixture('receipt-small.jpg');

    const response = await app.inject({
      method: 'POST',
      url: '/api/receipts',
      payload: multipartForm(bytes, 'receipt-small.jpg', 'image/jpeg'),
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts a small JPEG and returns 202, and the image endpoint returns the normalised JPEG', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const bytes = await readFixture('receipt-small.jpg');

    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/api/receipts',
      payload: multipartForm(bytes, 'receipt-small.jpg', 'image/jpeg'),
      headers: { cookie },
    });

    expect(uploadResponse.statusCode).toBe(202);
    const { id } = uploadResponse.json();
    expect(typeof id).toBe('number');

    const imageResponse = await app.inject({
      method: 'GET',
      url: `/api/receipts/${id}/image`,
      headers: { cookie },
    });

    expect(imageResponse.statusCode).toBe(200);
    expect(imageResponse.headers['content-type']).toBe('image/jpeg');
    expect(imageResponse.headers['cache-control']).toBe('private, max-age=86400');
    const metadata = await sharp(imageResponse.rawPayload).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(300);
    expect(metadata.height).toBe(500);
  });

  it('applies EXIF rotation so the stored image has swapped dimensions', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const bytes = await readFixture('rotated.jpg');

    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/api/receipts',
      payload: multipartForm(bytes, 'rotated.jpg', 'image/jpeg'),
      headers: { cookie },
    });
    const { id } = uploadResponse.json();

    const imageResponse = await app.inject({
      method: 'GET',
      url: `/api/receipts/${id}/image`,
      headers: { cookie },
    });
    const metadata = await sharp(imageResponse.rawPayload).metadata();

    expect(metadata.width).toBe(30);
    expect(metadata.height).toBe(40);
  });

  it('gives 409 with the first id when the same file is uploaded twice', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const bytes = await readFixture('receipt-small.jpg');

    const first = await app.inject({
      method: 'POST',
      url: '/api/receipts',
      payload: multipartForm(bytes, 'receipt-small.jpg', 'image/jpeg'),
      headers: { cookie },
    });
    const firstId = first.json().id;

    const second = await app.inject({
      method: 'POST',
      url: '/api/receipts',
      payload: multipartForm(bytes, 'receipt-small.jpg', 'image/jpeg'),
      headers: { cookie },
    });

    expect(second.statusCode).toBe(409);
    const body = second.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details.existingReceiptId).toBe(firstId);
  });

  it('gives 400 for a file that is not a recognised image', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);
    const bytes = await readFixture('not-an-image.txt');

    const response = await app.inject({
      method: 'POST',
      url: '/api/receipts',
      payload: multipartForm(bytes, 'not-an-image.txt', 'text/plain'),
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('gives 413 for a file over the configured limit', async () => {
    app = createTestApp({ env: { MAX_UPLOAD_BYTES: '1000' } });
    const cookie = await loginCookie(app);
    const bytes = await readFixture('receipt-small.jpg');
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const response = await app.inject({
      method: 'POST',
      url: '/api/receipts',
      payload: multipartForm(bytes, 'receipt-small.jpg', 'image/jpeg'),
      headers: { cookie },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('GET /api/receipts/:id/image', () => {
  it('gives 401 without the auth cookie', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/receipts/1/image' });

    expect(response.statusCode).toBe(401);
  });

  it('gives 404 for an id with no stored image', async () => {
    app = createTestApp();
    const cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/receipts/999/image',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
  });
});
