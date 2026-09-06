import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConflictError } from '../../src/server/lib/errors.ts';
import { createLogCapture, createTestApp } from '../helpers/createTestApp.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('error handling', () => {
  it('returns a NOT_FOUND shape for an unknown API route, with a matching x-request-id', async () => {
    app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.error.requestId).toBe('string');
    expect(response.headers['x-request-id']).toBe(body.error.requestId);
  });

  it('assigns a UUID request id that differs between requests and survives a restart', async () => {
    app = createTestApp();

    const first = await app.inject({ method: 'GET', url: '/api/health' });
    const second = await app.inject({ method: 'GET', url: '/api/health' });

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(first.headers['x-request-id']).toMatch(uuidPattern);
    expect(second.headers['x-request-id']).toMatch(uuidPattern);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('returns a generic INTERNAL shape and logs the real error for an unhandled exception', async () => {
    const logs = createLogCapture();
    app = createTestApp({ env: { LOG_LEVEL: 'error' }, logStream: logs });
    app.get('/api/__boom', async () => {
      throw new Error('boom');
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/__boom' });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('boom');
    expect(JSON.stringify(body)).not.toMatch(/stack/i);
    expect(typeof body.error.requestId).toBe('string');

    const errorLine = logs.lines().find((line) => line.level === 50);
    expect(errorLine).toBeDefined();
    expect(errorLine?.requestId).toBe(body.error.requestId);
    expect((errorLine?.err as { message: string; stack: string }).message).toBe('boom');
    expect((errorLine?.err as { stack: string }).stack).toContain('boom');
  });

  it('maps a thrown AppError to its status and code with details', async () => {
    app = createTestApp();
    app.get('/api/__conflict', async () => {
      throw new ConflictError('Finnes allerede', { existingReceiptId: 7 });
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/__conflict' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Finnes allerede',
        details: { existingReceiptId: 7 },
        requestId: expect.any(String),
      },
    });
  });

  it('maps a ZodError to 400 VALIDATION_ERROR with the issues as details', async () => {
    app = createTestApp();
    app.get('/api/__zod', async () => {
      z.object({ name: z.string() }).parse({ name: 42 });
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/__zod' });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0].path).toEqual(['name']);
  });

  it('maps a malformed JSON body from Fastify to a Norwegian 400 VALIDATION_ERROR and logs the original error at warn', async () => {
    const logs = createLogCapture();
    app = createTestApp({ env: { LOG_LEVEL: 'warn' }, logStream: logs });
    app.post('/api/__echo', async (request) => request.body);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/__echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Ugyldig forespørsel');

    const warnLine = logs.lines().find((line) => line.level === 40);
    expect(warnLine).toBeDefined();
    expect(warnLine?.requestId).toBe(body.error.requestId);
    expect((warnLine?.err as { message: string }).message).toMatch(/json/i);
  });

  it('maps an unsupported content type to 415 VALIDATION_ERROR instead of falling through to 500', async () => {
    app = createTestApp();
    app.post('/api/__echo', async (request) => request.body);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/__echo',
      headers: { 'content-type': 'application/xml' },
      payload: '<x/>',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('redacts the cookie header from request logs', async () => {
    const logs = createLogCapture();
    app = createTestApp({ env: { LOG_LEVEL: 'info' }, logStream: logs });

    await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { cookie: 'kvitteringer_auth=secret-cookie-value' },
    });

    const all = JSON.stringify(logs.lines());
    expect(all).not.toContain('secret-cookie-value');
  });
});
