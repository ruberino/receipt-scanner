/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App.tsx';

function renderApp(initialEntry: string) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function unauthorizedResponse(): Response {
  return jsonResponse(
    { error: { code: 'UNAUTHORIZED', message: 'Ikke innlogget', requestId: 'x' } },
    401,
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the login page when unauthenticated', async () => {
    vi.mocked(fetch).mockResolvedValue(unauthorizedResponse());

    renderApp('/');

    await waitFor(() => {
      expect(screen.getByLabelText('Passord')).toBeInTheDocument();
    });
  });

  it('shows the guarded shell with four tabs when authenticated', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ authenticated: true }));

    renderApp('/');

    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Handleliste' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Skann' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Kvitteringer' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Varer' })).toBeInTheDocument();
  });

  it('renders the receipt placeholder for a deep link to /receipts/:id when authenticated', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ authenticated: true }));

    renderApp('/receipts/42');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Kvittering' })).toBeInTheDocument();
    });
  });

  it('navigates to /login on a 401 from any query, not just auth/me', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ authenticated: true }));
    renderApp('/');
    await screen.findByRole('navigation');

    vi.mocked(fetch).mockResolvedValue(unauthorizedResponse());
    const { fetchJson } = await import('../../src/client/api/client.ts');
    await fetchJson('/api/products').catch(() => undefined);

    await waitFor(() => {
      expect(screen.getByLabelText('Passord')).toBeInTheDocument();
    });
  });
});
