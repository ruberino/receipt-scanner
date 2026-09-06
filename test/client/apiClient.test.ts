/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  fetchJson,
  setOnUnauthorized,
  uploadFile,
} from '../../src/client/api/client.ts';

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

class FakeXhr {
  static instances: FakeXhr[] = [];

  status = 0;
  responseText = '';
  withCredentials = false;
  upload: {
    onprogress:
      ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sentBody: unknown;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(): void {}

  send(body: unknown): void {
    this.sentBody = body;
  }
}

describe('uploadFile', () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setOnUnauthorized(null);
  });

  function lastXhr(): FakeXhr {
    return FakeXhr.instances.at(-1)!;
  }

  it('reports progress as loaded / total', async () => {
    const onProgress = vi.fn();
    const promise = uploadFile('/api/receipts', new Blob(['x']), onProgress);

    lastXhr().upload.onprogress!({ lengthComputable: true, loaded: 50, total: 200 });
    expect(onProgress).toHaveBeenCalledWith(0.25);

    lastXhr().status = 202;
    lastXhr().responseText = JSON.stringify({ id: 1 });
    lastXhr().onload!();
    await promise;
  });

  it('resolves a 202 with a JSON body to the parsed object', async () => {
    const promise = uploadFile('/api/receipts', new Blob(['x']));

    lastXhr().status = 202;
    lastXhr().responseText = JSON.stringify({ id: 7 });
    lastXhr().onload!();

    await expect(promise).resolves.toEqual({ id: 7 });
  });

  it('rejects a 409 with an ApiRequestError carrying details.existingReceiptId', async () => {
    const promise = uploadFile('/api/receipts', new Blob(['x']));

    lastXhr().status = 409;
    lastXhr().responseText = JSON.stringify({
      error: {
        code: 'CONFLICT',
        message: 'Denne kvitteringen er allerede skannet',
        details: { existingReceiptId: 5 },
        requestId: 'x',
      },
    });
    lastXhr().onload!();

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { existingReceiptId: 5 },
    });
  });

  it('calls onUnauthorized on a 401', async () => {
    const onUnauthorized = vi.fn();
    setOnUnauthorized(onUnauthorized);
    const promise = uploadFile('/api/receipts', new Blob(['x']));

    lastXhr().status = 401;
    lastXhr().responseText = JSON.stringify({
      error: { code: 'UNAUTHORIZED', message: 'Ikke innlogget', requestId: 'x' },
    });
    lastXhr().onload!();

    await expect(promise).rejects.toBeInstanceOf(ApiRequestError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('rejects a network error with status 0 and the generic message', async () => {
    const promise = uploadFile('/api/receipts', new Blob(['x']));

    lastXhr().onerror!();

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 0, code: 'INTERNAL', message: 'Noe gikk galt' });
  });
});
