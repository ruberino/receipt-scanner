/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReceiptDetail } from '../../src/shared/schemas.ts';
import { ApiRequestError } from '../../src/client/api/client.ts';
import ReceiptPage from '../../src/client/pages/ReceiptPage.tsx';
import { ToastProvider } from '../../src/client/components/Toast.tsx';

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return {
    ...actual,
    useReceipt: vi.fn(),
    useScanReceipt: vi.fn(),
    useUpdateReceipt: vi.fn(),
    useRematch: vi.fn(),
    useDeleteReceipt: vi.fn(),
    useProductSearch: vi.fn(),
    useUpdateReceiptLine: vi.fn(),
    useUpdateReceiptLineFields: vi.fn(),
    useDeleteReceiptLine: vi.fn(),
    useRecentDoneShoppingLists: vi.fn(),
    useInvalidateShoppingListsOnDone: vi.fn(),
  };
});

const {
  useReceipt,
  useScanReceipt,
  useUpdateReceipt,
  useRematch,
  useDeleteReceipt,
  useProductSearch,
  useUpdateReceiptLine,
  useUpdateReceiptLineFields,
  useDeleteReceiptLine,
  useRecentDoneShoppingLists,
} = await import('../../src/client/api/queries.ts');

function baseReceipt(overrides: Partial<ReceiptDetail> = {}): ReceiptDetail {
  return {
    id: 1,
    status: 'done',
    storeName: 'KIWI Torshov',
    purchasedAt: '2026-09-01',
    totalOre: 10000,
    lineCount: 1,
    warnings: [],
    errorMessage: null,
    possibleDuplicateOf: null,
    reviewedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    shoppingListId: null,
    shoppingList: null,
    imageUrl: '/api/receipts/1/image',
    lines: [
      {
        id: 1,
        lineNo: 1,
        kind: 'item',
        rawText: 'TINE LETTMELK 1L',
        quantity: 1,
        unit: 'stk',
        unitPriceOre: 10000,
        totalOre: 10000,
        product: { id: 1, name: 'Lettmelk 1 l', category: 'Meieri' },
        matchSource: 'alias',
      },
    ],
    ...overrides,
  };
}

function mockReceipt(receipt: ReceiptDetail) {
  vi.mocked(useReceipt).mockReturnValue({
    data: receipt,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useReceipt>);
}

function receiptPageTree() {
  return (
    <ToastProvider>
      <MemoryRouter initialEntries={['/receipts/1']}>
        <Routes>
          <Route path="/receipts/:id" element={<ReceiptPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

function renderReceiptPage() {
  return render(receiptPageTree());
}

describe('ReceiptPage — done state', () => {
  let updateMutate: ReturnType<typeof vi.fn>;
  let rematchMutate: ReturnType<typeof vi.fn>;
  let deleteMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(useScanReceipt).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useScanReceipt>);
    updateMutate = vi.fn();
    vi.mocked(useUpdateReceipt).mockReturnValue({
      mutate: updateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateReceipt>);
    rematchMutate = vi.fn();
    vi.mocked(useRematch).mockReturnValue({
      mutate: rematchMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useRematch>);
    deleteMutate = vi.fn();
    vi.mocked(useDeleteReceipt).mockReturnValue({
      mutate: deleteMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteReceipt>);
    vi.mocked(useProductSearch).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useProductSearch>);
    vi.mocked(useUpdateReceiptLine).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateReceiptLine>);
    vi.mocked(useUpdateReceiptLineFields).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateReceiptLineFields>);
    vi.mocked(useDeleteReceiptLine).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteReceiptLine>);
    vi.mocked(useRecentDoneShoppingLists).mockReturnValue({
      data: [
        {
          id: 5,
          weekStart: '2026-08-31',
          status: 'done',
          createdAt: '2026-08-31T00:00:00.000Z',
          completedAt: '2026-09-07T12:00:00.000Z',
          itemCount: 4,
          tripCounts: null,
        },
      ],
    } as unknown as ReturnType<typeof useRecentDoneShoppingLists>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a warning chip for every code present and none otherwise', () => {
    mockReceipt(baseReceipt({ warnings: ['TOTAL_MISMATCH', 'MISSING_STORE'] }));
    renderReceiptPage();

    expect(screen.getByText('Summen av linjene stemmer ikke med totalen')).toBeInTheDocument();
    expect(screen.getByText('Mangler butikknavn')).toBeInTheDocument();
    expect(screen.queryByText('Datoen er i fremtiden')).not.toBeInTheDocument();
  });

  it('shows no warning chips when there are none', () => {
    mockReceipt(baseReceipt({ warnings: [] }));
    renderReceiptPage();

    expect(screen.queryByText(/./, { selector: '.bg-yellow-100' })).not.toBeInTheDocument();
  });

  it('links the POSSIBLE_DUPLICATE chip to the other receipt', () => {
    mockReceipt(baseReceipt({ warnings: ['POSSIBLE_DUPLICATE'], possibleDuplicateOf: 42 }));
    renderReceiptPage();

    const link = screen.getByRole('link', {
      name: 'Ligner på kvittering #42, er den skannet to ganger?',
    });
    expect(link).toHaveAttribute('href', '/receipts/42');
  });

  it('renders Norwegian text for every one of the seven warning codes, never the raw code', () => {
    const allCodes = [
      'TOTAL_MISMATCH',
      'MISSING_STORE',
      'MISSING_DATE',
      'FUTURE_DATE',
      'UNMATCHED_LINES',
      'MATCHING_FAILED',
      'POSSIBLE_DUPLICATE',
    ];
    mockReceipt(baseReceipt({ warnings: allCodes, possibleDuplicateOf: 7 }));
    renderReceiptPage();

    for (const code of allCodes) {
      expect(screen.queryByText(code)).not.toBeInTheDocument();
    }
    expect(screen.getByText('Summen av linjene stemmer ikke med totalen')).toBeInTheDocument();
    expect(screen.getByText('Mangler butikknavn')).toBeInTheDocument();
    expect(screen.getByText('Mangler dato')).toBeInTheDocument();
    expect(screen.getByText('Datoen er i fremtiden')).toBeInTheDocument();
    expect(screen.getByText('Noen varer er ikke gjenkjent')).toBeInTheDocument();
    expect(screen.getByText('Automatisk varegjenkjenning feilet')).toBeInTheDocument();
    expect(
      screen.getByText('Ligner på kvittering #7, er den skannet to ganger?'),
    ).toBeInTheDocument();
  });

  it('keys the header on the receipt id, so a cached-receipt swap does not keep stale values', () => {
    mockReceipt(baseReceipt({ id: 1, storeName: 'KIWI Torshov' }));
    const { rerender } = renderReceiptPage();
    expect(screen.getByLabelText('Butikk')).toHaveValue('KIWI Torshov');

    mockReceipt(baseReceipt({ id: 2, storeName: 'REMA 1000' }));
    rerender(receiptPageTree());

    expect(screen.getByLabelText('Butikk')).toHaveValue('REMA 1000');
  });

  it('parses the total with parseNok and sends integer øre', async () => {
    mockReceipt(baseReceipt());
    renderReceiptPage();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Totalsum (kr)'));
    await user.type(screen.getByLabelText('Totalsum (kr)'), '43,80');
    await user.click(screen.getByRole('button', { name: 'Lagre' }));

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ totalOre: 4380 }),
      expect.anything(),
    );
  });

  it('shows "Ugyldig totalsum" and does not save when the total is not a valid amount', async () => {
    mockReceipt(baseReceipt());
    renderReceiptPage();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Totalsum (kr)'));
    await user.type(screen.getByLabelText('Totalsum (kr)'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Lagre' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Ugyldig totalsum');
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('saves the header through PATCH and shows the server message on error', async () => {
    mockReceipt(baseReceipt());
    updateMutate.mockImplementation((_body, options) => {
      options?.onError?.(
        new ApiRequestError(409, {
          code: 'CONFLICT',
          message: 'Kvitteringen er ikke ferdig behandlet',
          requestId: 'x',
        }),
      );
    });
    renderReceiptPage();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Butikk'));
    await user.type(screen.getByLabelText('Butikk'), 'REMA 1000');
    await user.click(screen.getByRole('button', { name: 'Lagre' }));

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ storeName: 'REMA 1000' }),
      expect.anything(),
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Kvitteringen er ikke ferdig behandlet');
    });
  });

  it('shows "Prøv matching igjen" only when there are unmatched lines', () => {
    mockReceipt(baseReceipt({ warnings: [] }));
    renderReceiptPage();
    expect(screen.queryByRole('button', { name: 'Prøv matching igjen' })).not.toBeInTheDocument();
  });

  it('shows and wires "Prøv matching igjen" when lines are unmatched', async () => {
    mockReceipt(baseReceipt({ warnings: ['UNMATCHED_LINES'] }));
    renderReceiptPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Prøv matching igjen' }));
    expect(rematchMutate).toHaveBeenCalledOnce();
  });

  it('sets reviewed through "Ferdig"', async () => {
    mockReceipt(baseReceipt());
    renderReceiptPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Ferdig' }));

    expect(updateMutate).toHaveBeenCalledWith({ reviewed: true }, expect.anything());
  });

  it('shows the server message in a toast when "Ferdig" is rejected', async () => {
    mockReceipt(baseReceipt());
    updateMutate.mockImplementation((_body, options) => {
      options?.onError?.(
        new ApiRequestError(409, {
          code: 'CONFLICT',
          message: 'Kvitteringen er ikke ferdig behandlet',
          requestId: 'x',
        }),
      );
    });
    renderReceiptPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Ferdig' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Kvitteringen er ikke ferdig behandlet');
    });
  });

  it('deletes the receipt after confirmation', async () => {
    mockReceipt(baseReceipt());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderReceiptPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Slett kvittering' }));

    expect(deleteMutate).toHaveBeenCalledOnce();
  });

  it('does not delete when the confirmation is dismissed', async () => {
    mockReceipt(baseReceipt());
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderReceiptPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Slett kvittering' }));

    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it('shows the receipt image beside the lines, linking to the full image (T35)', () => {
    mockReceipt(baseReceipt({ imageUrl: '/api/receipts/1/image' }));
    renderReceiptPage();

    const links = screen.getAllByRole('link', { name: 'Kvitteringsbilde' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/api/receipts/1/image');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
  });

  it('hides the image panel by default and toggles it with "Vis bilde"/"Skjul bilde" (T35)', async () => {
    mockReceipt(baseReceipt());
    renderReceiptPage();
    const user = userEvent.setup();

    // One image always renders for the desktop column (shown via a `md:` class, not JS); the
    // toggle adds a second, separate one for the phone panel.
    expect(screen.getAllByRole('img', { name: 'Kvitteringsbilde' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Vis bilde' }));
    const images = screen.getAllByRole('img', { name: 'Kvitteringsbilde' });
    expect(images).toHaveLength(2);

    // "Skjul bilde" must live inside the same sticky block as the phone's image (T35 review F1),
    // not back where "Vis bilde" was, or scrolling into the lines would leave it unreachable.
    const phoneImage = images[1] ?? null;
    const hideButton = screen.getByRole('button', { name: 'Skjul bilde' });
    expect(hideButton.closest('.sticky')).toContainElement(phoneImage);

    await user.click(hideButton);
    expect(screen.getAllByRole('img', { name: 'Kvitteringsbilde' })).toHaveLength(1);
  });

  it('remembers the image panel preference in sessionStorage across a remount (T35)', async () => {
    mockReceipt(baseReceipt());
    const { unmount } = renderReceiptPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Vis bilde' }));
    expect(sessionStorage.getItem('receipt-image-panel')).toBe('shown');
    unmount();

    renderReceiptPage();
    expect(screen.getByRole('button', { name: 'Skjul bilde' })).toBeInTheDocument();
  });

  it('renders item lines with a product picker and greys out discount/deposit lines without one', () => {
    mockReceipt(
      baseReceipt({
        lines: [
          {
            id: 1,
            lineNo: 1,
            kind: 'item',
            rawText: 'TINE LETTMELK 1L',
            quantity: 1,
            unit: 'stk',
            unitPriceOre: 10000,
            totalOre: 10000,
            product: { id: 1, name: 'Lettmelk 1 l', category: 'Meieri' },
            matchSource: 'alias',
          },
          {
            id: 2,
            lineNo: 2,
            kind: 'discount',
            rawText: 'RABATT',
            quantity: 1,
            unit: null,
            unitPriceOre: null,
            totalOre: -500,
            product: null,
            matchSource: null,
          },
        ],
      }),
    );
    renderReceiptPage();

    // Scoped by name: a native <select> (the T39 Handleliste selector) also has an implicit
    // combobox role, so an unscoped query would now match both.
    expect(screen.getByRole('combobox', { name: 'Vare' })).toBeInTheDocument();
    expect(screen.getByText('Rabatt')).toBeInTheDocument();
  });

  describe('Handleliste selector (T39)', () => {
    it('shows "Ingen" and the recent completed lists, with the note about automatic linking', () => {
      mockReceipt(baseReceipt());
      renderReceiptPage();

      const select = screen.getByLabelText('Handleliste') as HTMLSelectElement;
      expect(select).toHaveValue('');
      expect(screen.getByText('Uke 36, fullført 7. sep.')).toBeInTheDocument();
      expect(screen.getByText('Knyttes automatisk når datoene stemmer')).toBeInTheDocument();
    });

    it('links the receipt by selecting a list, through the existing PATCH', async () => {
      mockReceipt(baseReceipt());
      renderReceiptPage();
      const user = userEvent.setup();

      await user.selectOptions(screen.getByLabelText('Handleliste'), '5');

      expect(updateMutate).toHaveBeenCalledWith({ shoppingListId: 5 }, expect.anything());
    });

    it('unlinks the receipt by selecting "Ingen"', async () => {
      mockReceipt(
        baseReceipt({ shoppingListId: 5, shoppingList: { id: 5, weekStart: '2026-08-31' } }),
      );
      renderReceiptPage();
      const user = userEvent.setup();

      await user.selectOptions(screen.getByLabelText('Handleliste'), 'Ingen');

      expect(updateMutate).toHaveBeenCalledWith({ shoppingListId: null }, expect.anything());
    });

    it('shows a link to the linked list when shoppingList is set', () => {
      mockReceipt(
        baseReceipt({ shoppingListId: 5, shoppingList: { id: 5, weekStart: '2026-08-31' } }),
      );
      renderReceiptPage();

      const link = screen.getByRole('link', { name: 'Handleliste uke 36' });
      expect(link).toHaveAttribute('href', '/shopping-lists/5');
      expect((screen.getByLabelText('Handleliste') as HTMLSelectElement).value).toBe('5');
    });
  });
});
