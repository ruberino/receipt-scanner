/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  MonthlyStats,
  Product,
  ReceiptSummary,
  ShoppingListSummary,
} from '../../src/shared/schemas.ts';
import { ToastProvider } from '../../src/client/components/Toast.tsx';
import ReceiptsPage from '../../src/client/pages/ReceiptsPage.tsx';

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return {
    ...actual,
    useReceiptsList: vi.fn(),
    useScanReceipt: vi.fn(),
    useStatsSummary: vi.fn(),
    useShoppingListHistory: vi.fn(),
  };
});

const {
  useReceiptsList,
  useScanReceipt,
  useStatsSummary,
  useShoppingListHistory,
  receiptsListRefetchInterval,
} = await import('../../src/client/api/queries.ts');

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
    updatedAt: '2026-09-01T00:00:00.000Z',
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

function monthlyStats(overrides: Partial<MonthlyStats> = {}): MonthlyStats {
  return { month: '2026-09', totalOre: 1000, receipts: 1, ...overrides };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Lettmelk 1 l',
    category: 'Meieri',
    suppressed: false,
    timesBought: 3,
    lastBought: null,
    medianIntervalDays: null,
    ...overrides,
  };
}

function shoppingListSummary(overrides: Partial<ShoppingListSummary> = {}): ShoppingListSummary {
  return {
    id: 1,
    weekStart: '2026-08-31',
    status: 'open',
    createdAt: '2026-08-31T00:00:00.000Z',
    completedAt: null,
    itemCount: 3,
    ...overrides,
  };
}

function mockStats(extra: Partial<ReturnType<typeof useStatsSummary>> = {}) {
  vi.mocked(useStatsSummary).mockReturnValue({
    isPending: false,
    isError: false,
    isSuccess: true,
    data: { months: [monthlyStats()], topProducts: [product()] },
    ...extra,
  } as unknown as ReturnType<typeof useStatsSummary>);
}

function mockHistory(extra: Partial<ReturnType<typeof useShoppingListHistory>> = {}) {
  vi.mocked(useShoppingListHistory).mockReturnValue({
    isPending: false,
    isError: false,
    isSuccess: true,
    data: [shoppingListSummary()],
    ...extra,
  } as unknown as ReturnType<typeof useShoppingListHistory>);
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('renders store, date, total and status for a done receipt', () => {
    mockList([
      [receipt({ id: 1, storeName: 'KIWI Torshov', purchasedAt: '2026-09-01', totalOre: 12345 })],
    ]);
    mockScan();

    renderReceiptsPage();

    expect(screen.getByText('KIWI Torshov')).toBeInTheDocument();
    expect(screen.getByText(/123,45\s*kr/)).toBeInTheDocument();
    expect(screen.getByText('Ferdig')).toBeInTheDocument();
  });

  it('shows the warning count when there are warnings', () => {
    mockList([[receipt({ id: 1, warnings: ['MISSING_STORE', 'MISSING_DATE'] })]]);
    mockScan();

    renderReceiptsPage();

    expect(screen.getByText('2 varsler')).toBeInTheDocument();
  });

  it('shows "Ukjent butikk" only when done, "Ikke skannet ennå" when uploaded and "Lesing feilet" when failed, all without a store name (T19 F1)', () => {
    mockList([
      [
        receipt({ id: 1, status: 'done', storeName: null }),
        receipt({ id: 2, status: 'uploaded', storeName: null }),
        receipt({ id: 3, status: 'failed', storeName: null }),
      ],
    ]);
    mockScan();

    renderReceiptsPage();

    expect(screen.getByText('Ukjent butikk')).toBeInTheDocument();
    expect(screen.getByText('Ikke skannet ennå')).toBeInTheDocument();
    expect(screen.getByText('Lesing feilet')).toBeInTheDocument();
  });

  it('shows the upload date instead of "–" when there is no purchasedAt, but keeps "–" for an unknown total (T19 F1)', () => {
    mockList([
      [
        receipt({
          id: 1,
          status: 'uploaded',
          storeName: null,
          purchasedAt: null,
          totalOre: null,
          createdAt: '2026-09-01T00:00:00.000Z',
        }),
      ],
    ]);
    mockScan();

    renderReceiptsPage();

    expect(screen.getByText(/^Lastet opp /)).toBeInTheDocument();
    expect(screen.getAllByText('–')).toHaveLength(1);
  });

  it('shows the date and the relative form together for a purchased receipt (T33)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T10:00:00.000Z'));
    mockList([[receipt({ id: 1, purchasedAt: '2026-09-04' })]]);
    mockScan();

    renderReceiptsPage();

    expect(screen.getByText('4. sep. · 3 dager siden')).toBeInTheDocument();
  });

  it('reads the upload date through Oslo local time, not a naive UTC slice (T19 F1, T33)', () => {
    vi.useFakeTimers();
    // Far past any 30-day relative window either interpretation could produce, so the assertion
    // isolates the date conversion itself rather than the relative-days branch.
    vi.setSystemTime(new Date('2026-12-01T12:00:00.000Z'));
    mockList([
      [
        receipt({
          id: 1,
          purchasedAt: null,
          // 22:30 UTC on 7 September is already past midnight (00:30 CEST) on the 8th in Oslo.
          createdAt: '2026-09-07T22:30:00.000Z',
        }),
      ],
    ]);
    mockScan();

    renderReceiptsPage();

    expect(screen.getByText('Lastet opp 8. sep.')).toBeInTheDocument();
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

describe('ReceiptsPage — Statistikk og historikk', () => {
  it('renders collapsed, with the two hooks not enabled', () => {
    mockList([[receipt({ id: 1 })]]);
    mockScan();
    mockStats();
    mockHistory();

    renderReceiptsPage();

    expect(screen.getByText('Statistikk og historikk')).toBeInTheDocument();
    expect(screen.queryByText('Mest kjøpt, alle kvitteringer')).not.toBeInTheDocument();
    expect(vi.mocked(useStatsSummary)).toHaveBeenCalledWith(false);
    expect(vi.mocked(useShoppingListHistory)).toHaveBeenCalledWith(false);
  });

  it('enables both hooks once opened, and renders monthly bars, top products and list history', async () => {
    mockList([[receipt({ id: 1 })]]);
    mockScan();
    mockStats({
      data: {
        months: [monthlyStats({ month: '2026-08', totalOre: 5000 })],
        topProducts: [product({ name: 'Lettmelk 1 l', timesBought: 4 })],
      },
    });
    mockHistory({
      data: [shoppingListSummary({ weekStart: '2026-08-24', status: 'done', itemCount: 5 })],
    });

    renderReceiptsPage();
    const user = userEvent.setup();
    await user.click(screen.getByText('Statistikk og historikk'));

    expect(vi.mocked(useStatsSummary)).toHaveBeenCalledWith(true);
    expect(vi.mocked(useShoppingListHistory)).toHaveBeenCalledWith(true);
    expect(screen.getByText('aug. 2026')).toBeInTheDocument();
    expect(screen.getByText(/50,00\s*kr/)).toBeInTheDocument();
    expect(screen.getByText('Mest kjøpt, alle kvitteringer')).toBeInTheDocument();
    expect(screen.getByText('Lettmelk 1 l')).toBeInTheDocument();
    expect(screen.getByText('4×')).toBeInTheDocument();
    expect(screen.getByText('Uke 35, 2026')).toBeInTheDocument();
    expect(screen.getByText('5 varer')).toBeInTheDocument();
    expect(screen.getByText('Fullført')).toBeInTheDocument();
  });

  it('shows a loading state and an error state independently for stats and history', async () => {
    mockList([[receipt({ id: 1 })]]);
    mockScan();
    mockStats({ isPending: true, isSuccess: false, data: undefined });
    mockHistory({ isError: true, isSuccess: false, data: undefined });

    renderReceiptsPage();
    const user = userEvent.setup();
    await user.click(screen.getByText('Statistikk og historikk'));

    expect(screen.getByText('Laster …')).toBeInTheDocument();
    expect(screen.getByText('Noe gikk galt')).toBeInTheDocument();
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
