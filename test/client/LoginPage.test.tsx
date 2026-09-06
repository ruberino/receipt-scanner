/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../../src/client/pages/LoginPage.tsx';

vi.mock('../../src/client/api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/client.ts')>();
  return {
    ...actual,
    fetchJson: vi.fn(),
  };
});

const { fetchJson } = await import('../../src/client/api/client.ts');
const { ApiRequestError } = await import('../../src/client/api/client.ts');

function renderLoginPage() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset();
  });

  it('shows "Feil passord" on a 401', async () => {
    vi.mocked(fetchJson).mockRejectedValue(
      new ApiRequestError(401, { code: 'UNAUTHORIZED', message: 'Feil passord', requestId: 'x' }),
    );
    renderLoginPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Passord'), 'feil-passord');
    await user.click(screen.getByRole('button', { name: 'Logg inn' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Feil passord');
    });
  });

  it('shows "Prøv igjen om litt" on a 429', async () => {
    vi.mocked(fetchJson).mockRejectedValue(
      new ApiRequestError(429, {
        code: 'RATE_LIMITED',
        message: 'For mange forsøk. Prøv igjen om et minutt.',
        requestId: 'x',
      }),
    );
    renderLoginPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Passord'), 'et-passord');
    await user.click(screen.getByRole('button', { name: 'Logg inn' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Prøv igjen om litt');
    });
  });

  it('shows "Noe gikk galt" on any other error', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('network down'));
    renderLoginPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Passord'), 'et-passord');
    await user.click(screen.getByRole('button', { name: 'Logg inn' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Noe gikk galt');
    });
  });
});
