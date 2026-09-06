/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, fetchJson, setOnUnauthorized } from '../../src/client/api/client.ts';

describe('fetchJson', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setOnUnauthorized(null);
  });

  it('returns the parsed JSON body on success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );

    await expect(fetchJson('/api/health')).resolves.toEqual({ status: 'ok' });
  });

  it('returns undefined for a 204 response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await expect(fetchJson('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('sends Content-Type: application/json when there is a body', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await fetchJson('/api/products', { method: 'POST', body: JSON.stringify({ name: 'Ost' }) });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('omits Content-Type for a bodyless request, since Fastify rejects an empty JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await fetchJson('/api/product-aliases/1', { method: 'DELETE' });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('parses the error body and throws an ApiRequestError', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'NOT_FOUND', message: 'Finnes ikke', requestId: 'abc' },
        }),
        { status: 404 },
      ),
    );

    const error = await fetchJson('/api/products/999').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Finnes ikke',
      requestId: 'abc',
    });
  });

  it('falls back to a generic error when the error body is not valid JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('not json', { status: 500 }));

    const error = await fetchJson('/api/products').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 500, code: 'INTERNAL', message: 'Noe gikk galt' });
  });

  it('calls onUnauthorized on a 401 outside the login endpoint', async () => {
    const onUnauthorized = vi.fn();
    setOnUnauthorized(onUnauthorized);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'Ikke innlogget', requestId: 'x' },
        }),
        { status: 401 },
      ),
    );

    await expect(fetchJson('/api/products')).rejects.toBeInstanceOf(ApiRequestError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not call onUnauthorized for a 401 from the login endpoint itself', async () => {
    const onUnauthorized = vi.fn();
    setOnUnauthorized(onUnauthorized);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'Feil passord', requestId: 'x' },
        }),
        { status: 401 },
      ),
    );

    await expect(fetchJson('/api/auth/login', { method: 'POST' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
