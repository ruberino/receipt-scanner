import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.ts';
import { loadConfig } from '../../src/server/config.ts';
import { TEST_ENV } from '../helpers/createTestApp.ts';
import { loginCookie } from '../helpers/login.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureClientDir = path.resolve(here, '..', 'fixtures', 'client');

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function createProductionApp(): FastifyInstance {
  const config = loadConfig({ ...TEST_ENV, NODE_ENV: 'production' });
  return buildApp({ config, databasePath: ':memory:', clientDir: fixtureClientDir });
}

describe('buildApp decorations', () => {
  it('decorates both db and sqlite, per T03', async () => {
    app = createProductionApp();
    await app.ready();

    expect(app.sqlite.prepare('select 1 as one').get()).toEqual({ one: 1 });
    expect(app.db.$client).toBe(app.sqlite);
  });
});

describe('static serving and SPA fallback in production', () => {
  it('serves index.html for an HTML navigation to an unknown client route', async () => {
    app = createProductionApp();

    const response = await app.inject({
      method: 'GET',
      url: '/receipts/42',
      headers: { accept: 'text/html' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Kvitteringer (test fixture)');
  });

  it('returns a plain 404 for a missing asset instead of the SPA shell', async () => {
    app = createProductionApp();

    const response = await app.inject({
      method: 'GET',
      url: '/assets/missing.js',
      headers: { accept: '*/*' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('Kvitteringer (test fixture)');
  });

  it('still returns the documented JSON shape for an unknown API route', async () => {
    app = createProductionApp();
    const cookie = await loginCookie(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/nope',
      headers: { accept: 'text/html', cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});
