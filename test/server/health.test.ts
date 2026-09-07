import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/createTestApp.ts';

describe('GET /api/health', () => {
  it('returns ok, a version string, the queue length, replication off and the active model without auth', async () => {
    const app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      version: expect.any(String),
      queueLength: 0,
      replication: 'off',
      model: 'kimi-k2.6',
    });

    await app.close();
  });

  it('reports the grok model when LLM_PROVIDER=grok (T27)', async () => {
    const app = createTestApp({ env: { LLM_PROVIDER: 'grok', XAI_API_KEY: 'xai-test-key' } });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.json()).toMatchObject({ model: 'grok-4.6' });

    await app.close();
  });

  it('reports replication on when LITESTREAM_BUCKET is configured', async () => {
    const app = createTestApp({ env: { LITESTREAM_BUCKET: 'receipt-scanner-drill' } });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.json()).toMatchObject({ replication: 'on' });

    await app.close();
  });

  it('treats an empty-string LITESTREAM_BUCKET (env_file with no value) as not configured', async () => {
    const app = createTestApp({ env: { LITESTREAM_BUCKET: '' } });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.json()).toMatchObject({ replication: 'off' });

    await app.close();
  });
});
