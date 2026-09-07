import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/createTestApp.ts';

describe('GET /api/health', () => {
  it('returns ok, a version string, the queue length, replication off and both models without auth', async () => {
    const app = createTestApp();

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      version: expect.any(String),
      queueLength: 0,
      replication: 'off',
      model: 'kimi-k2.6',
      proposalModel: 'kimi-k2.6',
    });

    await app.close();
  });

  it('reports the grok model for both when LLM_PROVIDER=grok (T27)', async () => {
    const app = createTestApp({ env: { LLM_PROVIDER: 'grok', XAI_API_KEY: 'xai-test-key' } });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.json()).toMatchObject({ model: 'grok-4.6', proposalModel: 'grok-4.6' });

    await app.close();
  });

  it('reports differing model and proposalModel when LLM_PROVIDER and LLM_PROVIDER_PROPOSE differ (ADR-0017, T38)', async () => {
    const app = createTestApp({
      env: { LLM_PROVIDER: 'grok', XAI_API_KEY: 'xai-test-key', LLM_PROVIDER_PROPOSE: 'kimi' },
    });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.json()).toMatchObject({ model: 'grok-4.6', proposalModel: 'kimi-k2.6' });

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
