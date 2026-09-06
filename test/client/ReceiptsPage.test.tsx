/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ReceiptSummary } from '../../src/shared/schemas.ts';
import { ToastProvider } from '../../src/client/components/Toast.tsx';
import ReceiptsPage from '../../src/client/pages/ReceiptsPage.tsx';

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return { ...actual, useReceiptsList: vi.fn(), useScanReceipt: vi.fn() };
});

const { useReceiptsList, useScanReceipt, receiptsListRefetchInterval } =
  await import('../../src/client/api/queries.ts');

function renderReceiptsPage() {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/receipts']}>
        <ReceiptsPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

function receipt(overrides: Partial<ReceiptSummary> = {}): ReceiptSummary {
  return {
    id: 1,
    status: 'done',
    storeName: 'KIWI Torshov',
    purchasedAt: '2026-09-01',
    totalOre: 12345,
    lineCount: 3,
    warnings: [],
    errorMessage: null,
    possibleDuplicateOf: null,
    reviewedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockList(
  pages: ReceiptSummary[][],
  extra: Partial<ReturnType<typeof useReceiptsList>> = {},
) {
  vi.mocked(useReceiptsList).mockReturnValue({
    data: { pages, pageParams: pages.map(() => undefined) },
    isPending: false,
    isError: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...extra,
  } as unknown as ReturnType<typeof useReceiptsList>);
}

function mockScan(
  mutateAsync: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
  isPending = false,
) {
  const call = mutateAsync as unknown as (id: number) => Promise<unknown>;
  const mutate = vi.fn((id: number, options?: { onError?: (error: unknown) => void }) => {
    call(id).catch((error: unknown) => options?.onError?.(error));
  });
  vi.mocked(useScanReceipt).mockReturnValue({
    mutate,
    mutateAsync,
    isPending,
  } as unknown as ReturnType<typeof useScanReceipt>);
  return { mutate, mutateAsync };
}

describe('ReceiptsPage', () => {
  it('shows a loading state before the first fetch resolves', () => {
    mockList([]);
    mockScan();
    vi.mocked(useReceiptsList).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    } as unknown as ReturnType<typeof useReceiptsList>);

    renderReceiptsPage();

    expect(screen.getByText('Laster …')).toBeInTheDocument();
  });

  it('shows an empty state with no receipts', () => {
    mockList([[]]);
    mockScan();

    renderReceiptsPage();

    expect(screen.getByText('Ingen kvitteringer ennå.')).toBeInTheDocument();
  });

  it('renders store, date, total and status for each receipt, with fallbacks for missing fields', () => {
    mockList([
      [
        receipt({ id: 1, storeName: 'KIWI Torshov', purchasedAt: '2026-09-01', totalOre: 12345 }),
        receipt({
          id: 2,
          status: 'uploaded',
          storeName: null,
          purchasedAt: null,
          totalOre: null,
          warnings: ['MISSING_STORE', 'MISSING_DATE'],
        }),
      ],
    ]);
    mockScan();

    renderReceiptsPage();

    expect(screen.getByText('KIWI Torshov')).toBeInTheDocument();
    expect(screen.getByText(/123,45\s*kr/)).toBeInTheDocument();
    expect(screen.getByText('Ukjent butikk')).toBeInTheDocument();
    expect(screen.getByText('2 varsler')).toBeInTheDocument();
    expect(screen.getAllByText('–')).toHaveLength(2);
    expect(screen.getByText('Ferdig')).toBeInTheDocument();
    expect(screen.getByText('Lastet opp')).toBeInTheDocument();
  });

  it('links each row to its receipt', () => {
    mockList([[receipt({ id: 7 })]]);
    mockScan();

    renderReceiptsPage();

    expect(screen.getByRole('link', { name: /KIWI Torshov/ })).toHaveAttribute(
      'href',
      '/receipts/7',
    );
  });

  it('shows "Skann" only on uploaded rows and calls scan for that id', async () => {
    mockList([[receipt({ id: 1, status: 'done' }), receipt({ id: 2, status: 'uploaded' })]]);
    const { mutateAsync } = mockScan();

    renderReceiptsPage();
    const user = userEvent.setup();

    const scanButtons = screen.getAllByRole('button', { name: 'Skann' });
    expect(scanButtons).toHaveLength(1);
    await user.click(scanButtons[0]!);

    expect(mutateAsync).toHaveBeenCalledWith(2);
  });

  it('has no "Skann alle" button with no uploaded receipts', () => {
    mockList([[receipt({ id: 1, status: 'done' })]]);
    mockScan();

    renderReceiptsPage();

    expect(screen.queryByRole('button', { name: /Skann alle/ })).not.toBeInTheDocument();
  });

  it('"Skann alle (n)" scans every uploaded receipt in order', async () => {
    mockList([
      [
        receipt({ id: 1, status: 'uploaded' }),
        receipt({ id: 2, status: 'done' }),
        receipt({ id: 3, status: 'uploaded' }),
      ],
    ]);
    const { mutateAsync } = mockScan(vi.fn().mockResolvedValue(receipt({ status: 'pending' })));

    renderReceiptsPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Skann alle (2)' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls.map((call) => call[0])).toEqual([1, 3]);
  });

  it('shows a toast when a scan fails', async () => {
    mockList([[receipt({ id: 1, status: 'uploaded' })]]);
    const mutateAsync = vi.fn().mockRejectedValue(new Error('nettverksfeil'));
    mockScan(mutateAsync);

    renderReceiptsPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Skann' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Noe gikk galt');
    });
  });

  it('shows "Last flere" when there is another page, and calls fetchNextPage', async () => {
    const fetchNextPage = vi.fn();
    mockList([[receipt({ id: 1 })]], { hasNextPage: true, fetchNextPage });
    mockScan();

    renderReceiptsPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Last flere' }));

    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('has no "Last flere" button on the last page', () => {
    mockList([[receipt({ id: 1 })]], { hasNextPage: false });
    mockScan();

    renderReceiptsPage();

    expect(screen.queryByRole('button', { name: 'Last flere' })).not.toBeInTheDocument();
  });
});

describe('receiptsListRefetchInterval', () => {
  it('keeps polling while any page has a pending or processing receipt', () => {
    expect(
      receiptsListRefetchInterval([[receipt({ status: 'done' }), receipt({ status: 'pending' })]]),
    ).toBe(2000);
    expect(receiptsListRefetchInterval([[receipt({ status: 'processing' })]])).toBe(2000);
  });

  it('stops polling once nothing is pending or processing', () => {
    expect(receiptsListRefetchInterval([[receipt({ status: 'done' })]])).toBe(false);
    expect(receiptsListRefetchInterval([])).toBe(false);
    expect(receiptsListRefetchInterval(undefined)).toBe(false);
  });
});
