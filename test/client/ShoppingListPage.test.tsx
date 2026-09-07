/** @vitest-environment jsdom */
import { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Product,
  ShoppingList,
  ShoppingListItem,
  ShoppingListProposal,
  ShoppingListProposalItem,
  ShoppingListSummary,
  Suggestion,
} from '../../src/shared/schemas.ts';
import ShoppingListPage from '../../src/client/pages/ShoppingListPage.tsx';
import { ToastProvider } from '../../src/client/components/Toast.tsx';

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return {
    ...actual,
    useSuggestions: vi.fn(),
    useCurrentShoppingList: vi.fn(),
    useLatestShoppingList: vi.fn(),
    useCreateShoppingList: vi.fn(),
    useCreateShoppingListItem: vi.fn(),
    useCompleteShoppingList: vi.fn(),
    useReopenShoppingList: vi.fn(),
    useDeleteShoppingList: vi.fn(),
    useRefreshShoppingList: vi.fn(),
    useToggleShoppingListItem: vi.fn(),
    useUpdateShoppingListItem: vi.fn(),
    useDeleteShoppingListItem: vi.fn(),
    useProductSearch: vi.fn(),
    useCreateProposal: vi.fn(),
    useAcceptProposal: vi.fn(),
  };
});

const {
  useSuggestions,
  useCurrentShoppingList,
  useLatestShoppingList,
  useCreateShoppingList,
  useCreateShoppingListItem,
  useCompleteShoppingList,
  useReopenShoppingList,
  useDeleteShoppingList,
  useRefreshShoppingList,
  useToggleShoppingListItem,
  useUpdateShoppingListItem,
  useDeleteShoppingListItem,
  useProductSearch,
  useCreateProposal,
  useAcceptProposal,
} = await import('../../src/client/api/queries.ts');

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    productId: 1,
    name: 'Lettmelk 1 l',
    category: 'Meieri',
    reason: 'Kjøpes ca. hver 7. dag, sist for 7 dager siden',
    quantityText: '1 stk',
    score: 1,
    ...overrides,
  };
}

function item(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: 1,
    productId: 1,
    name: 'Lettmelk 1 l',
    quantityText: '1 stk',
    source: 'suggested',
    reason: 'Kjøpes ca. hver 7. dag, sist for 7 dager siden',
    checked: false,
    position: 1,
    category: 'Meieri',
    ...overrides,
  };
}

function list(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: 1,
    weekStart: '2026-09-07',
    status: 'open',
    createdAt: '2026-09-06T00:00:00.000Z',
    completedAt: null,
    items: [item()],
    ...overrides,
  };
}

function listSummary(overrides: Partial<ShoppingListSummary> = {}): ShoppingListSummary {
  return {
    id: 1,
    weekStart: '2026-08-31',
    status: 'done',
    createdAt: '2026-09-06T00:00:00.000Z',
    completedAt: '2026-09-06T00:00:00.000Z',
    itemCount: 2,
    ...overrides,
  };
}

function proposalItem(overrides: Partial<ShoppingListProposalItem> = {}): ShoppingListProposalItem {
  return {
    index: 0,
    productId: null,
    name: 'Godteri',
    category: 'Snacks',
    quantityText: '1 pose',
    reason: 'Halloween 31. oktober',
    kind: 'merkedag',
    ...overrides,
  };
}

function proposal(overrides: Partial<ShoppingListProposal> = {}): ShoppingListProposal {
  return {
    id: 1,
    createdAt: '2026-09-07T12:00:00.000Z',
    model: 'grok-4.6',
    items: [proposalItem()],
    ...overrides,
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 5,
    name: 'Kaffe',
    category: 'Drikke',
    suppressed: false,
    timesBought: 3,
    lastBought: '2026-09-01',
    medianIntervalDays: 14,
    ...overrides,
  };
}

function mockNoList() {
  vi.mocked(useCurrentShoppingList).mockReturnValue({
    data: null,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useCurrentShoppingList>);
}

function mockList(theList: ShoppingList) {
  vi.mocked(useCurrentShoppingList).mockReturnValue({
    data: theList,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useCurrentShoppingList>);
}

function mockSuggestions(suggestions: Suggestion[]) {
  vi.mocked(useSuggestions).mockReturnValue({
    data: suggestions,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useSuggestions>);
}

function mockLatestList(summary: ShoppingListSummary | null) {
  vi.mocked(useLatestShoppingList).mockReturnValue({
    data: summary,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useLatestShoppingList>);
}

function renderPage() {
  render(
    <ToastProvider>
      <MemoryRouter>
        <ShoppingListPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('ShoppingListPage', () => {
  let createListMutate: ReturnType<typeof vi.fn>;
  let createItemMutate: ReturnType<typeof vi.fn>;
  let completeMutate: ReturnType<typeof vi.fn>;
  let reopenMutate: ReturnType<typeof vi.fn>;
  let deleteListMutate: ReturnType<typeof vi.fn>;
  let refreshMutate: ReturnType<typeof vi.fn>;
  let toggleMutate: ReturnType<typeof vi.fn>;
  let updateItemMutate: ReturnType<typeof vi.fn>;
  let deleteItemMutate: ReturnType<typeof vi.fn>;
  let createProposalMutate: ReturnType<typeof vi.fn>;
  let acceptProposalMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createListMutate = vi.fn();
    createItemMutate = vi.fn();
    completeMutate = vi.fn();
    reopenMutate = vi.fn();
    deleteListMutate = vi.fn();
    refreshMutate = vi.fn();
    toggleMutate = vi.fn();
    updateItemMutate = vi.fn();
    deleteItemMutate = vi.fn();
    createProposalMutate = vi.fn();
    acceptProposalMutate = vi.fn();
    mockLatestList(null);
    vi.mocked(useCreateShoppingList).mockReturnValue({
      mutate: createListMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateShoppingList>);
    vi.mocked(useCreateShoppingListItem).mockReturnValue({
      mutate: createItemMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateShoppingListItem>);
    vi.mocked(useCompleteShoppingList).mockReturnValue({
      mutate: completeMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCompleteShoppingList>);
    vi.mocked(useReopenShoppingList).mockReturnValue({
      mutate: reopenMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useReopenShoppingList>);
    vi.mocked(useDeleteShoppingList).mockReturnValue({
      mutate: deleteListMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteShoppingList>);
    vi.mocked(useRefreshShoppingList).mockReturnValue({
      mutate: refreshMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useRefreshShoppingList>);
    vi.mocked(useToggleShoppingListItem).mockReturnValue({
      mutate: toggleMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useToggleShoppingListItem>);
    vi.mocked(useUpdateShoppingListItem).mockReturnValue({
      mutate: updateItemMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateShoppingListItem>);
    vi.mocked(useDeleteShoppingListItem).mockReturnValue({
      mutate: deleteItemMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteShoppingListItem>);
    vi.mocked(useProductSearch).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useProductSearch>);
    vi.mocked(useCreateProposal).mockReturnValue({
      mutate: createProposalMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateProposal>);
    vi.mocked(useAcceptProposal).mockReturnValue({
      mutate: acceptProposalMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useAcceptProposal>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('with no open list', () => {
    it('shows a loading state before the first fetch resolves', () => {
      vi.mocked(useCurrentShoppingList).mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
      } as unknown as ReturnType<typeof useCurrentShoppingList>);
      mockSuggestions([]);

      renderPage();

      expect(screen.getByText('Laster …')).toBeInTheDocument();
    });

    it('shows suggestions as cards with reason and quantity, and a "Lag handleliste" button', () => {
      mockNoList();
      mockSuggestions([suggestion()]);

      renderPage();

      expect(screen.getByText('Lettmelk 1 l')).toBeInTheDocument();
      expect(
        screen.getByText('Kjøpes ca. hver 7. dag, sist for 7 dager siden'),
      ).toBeInTheDocument();
      expect(screen.getByText('1 stk')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Lag handleliste' })).toBeInTheDocument();
    });

    it('shows "Forslag til uke N" for the ISO week containing today (T32)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-07T10:00:00.000Z'));
      mockNoList();
      mockSuggestions([]);

      renderPage();

      expect(screen.getByText('Forslag til uke 37')).toBeInTheDocument();
    });

    it('creates a list when "Lag handleliste" is clicked', async () => {
      mockNoList();
      mockSuggestions([suggestion()]);
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Lag handleliste' }));

      expect(createListMutate).toHaveBeenCalledWith(undefined, expect.anything());
    });

    it('moves from the preview to the list view once a list exists (T18 acceptance)', () => {
      mockNoList();
      mockSuggestions([suggestion()]);
      const { rerender } = render(
        <ToastProvider>
          <MemoryRouter>
            <ShoppingListPage />
          </MemoryRouter>
        </ToastProvider>,
      );
      expect(screen.getByRole('button', { name: 'Lag handleliste' })).toBeInTheDocument();

      mockList(list());
      rerender(
        <ToastProvider>
          <MemoryRouter>
            <ShoppingListPage />
          </MemoryRouter>
        </ToastProvider>,
      );

      expect(screen.queryByRole('button', { name: 'Lag handleliste' })).not.toBeInTheDocument();
      expect(screen.getByText('Lettmelk 1 l')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ferdig handlet' })).toBeInTheDocument();
    });

    it('offers "Gjenåpne listen" when the latest list was completed today in Oslo (T31)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-06T15:00:00.000Z'));
      mockNoList();
      mockSuggestions([]);
      mockLatestList(
        listSummary({ id: 9, status: 'done', completedAt: '2026-09-06T12:12:00.000Z' }),
      );

      renderPage();

      expect(screen.getByText('Handleturen ble fullført kl. 14:12')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Gjenåpne listen' })).toBeInTheDocument();
    });

    it('does not offer "Gjenåpne listen" for a list completed on an earlier day (T31)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-07T10:00:00.000Z'));
      mockNoList();
      mockSuggestions([]);
      mockLatestList(
        listSummary({ id: 9, status: 'done', completedAt: '2026-09-06T12:12:00.000Z' }),
      );

      renderPage();

      expect(screen.queryByRole('button', { name: 'Gjenåpne listen' })).not.toBeInTheDocument();
    });

    it('does not offer "Gjenåpne listen" when the latest list is still open', () => {
      mockNoList();
      mockSuggestions([]);
      mockLatestList(listSummary({ status: 'open', completedAt: null }));

      renderPage();

      expect(screen.queryByRole('button', { name: 'Gjenåpne listen' })).not.toBeInTheDocument();
    });

    it('calls reopen when "Gjenåpne listen" is tapped', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-06T15:00:00.000Z'));
      mockNoList();
      mockSuggestions([]);
      mockLatestList(
        listSummary({ id: 9, status: 'done', completedAt: '2026-09-06T12:12:00.000Z' }),
      );
      renderPage();

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Gjenåpne listen' }));
      });

      expect(reopenMutate).toHaveBeenCalledWith(undefined, expect.anything());
    });
  });

  describe('with an open list', () => {
    it('shows unchecked items first and checked items in a plain "Kjøpt" section below (T31)', () => {
      mockList(
        list({
          items: [
            item({ id: 1, name: 'Kaffe', checked: false, position: 1 }),
            item({ id: 2, name: 'Lettmelk 1 l', checked: true, position: 2 }),
          ],
        }),
      );

      renderPage();

      expect(screen.getByText('Kaffe')).toBeInTheDocument();
      expect(screen.getByText('Kjøpt (1)')).toBeInTheDocument();
      expect(screen.getByText('Lettmelk 1 l')).toBeInTheDocument();
      // Plain section, not a collapsed <details>: the checked item is visible without opening anything.
      expect(screen.getByText('Kjøpt (1)').closest('details')).toBeNull();
    });

    it('shows the ISO week and "x av n kjøpt" progress in the header (T32)', () => {
      mockList(
        list({
          weekStart: '2026-09-07',
          items: [
            item({ id: 1, name: 'Kaffe', checked: true }),
            item({ id: 2, name: 'Lettmelk 1 l', checked: false }),
            item({ id: 3, name: 'Brød', checked: false }),
          ],
        }),
      );

      renderPage();

      expect(screen.getByText('Handleliste uke 37')).toBeInTheDocument();
      expect(screen.getByText('1 av 3 kjøpt')).toBeInTheDocument();
    });

    it('groups unchecked items by category in store-walk order, a manual item without a product under "Annet", and renders no heading for an empty group (T32)', () => {
      mockList(
        list({
          items: [
            item({ id: 1, name: 'Kylling', checked: false, category: 'Kjøtt og fisk' }),
            item({ id: 2, name: 'Eple', checked: false, category: 'Frukt og grønt' }),
            item({
              id: 3,
              name: 'Handlenett',
              checked: false,
              category: null,
              productId: null,
              source: 'manual',
              reason: null,
            }),
          ],
        }),
      );

      renderPage();

      const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(headings).toEqual(['Frukt og grønt', 'Kjøtt og fisk', 'Annet']);
      expect(screen.queryByText('Meieri')).not.toBeInTheDocument();
      expect(screen.getByText('Handlenett')).toBeInTheDocument();
    });

    it('sorts items alphabetically (nb) within a category group', () => {
      mockList(
        list({
          items: [
            item({ id: 1, name: 'Yoghurt', checked: false, category: 'Meieri' }),
            item({ id: 2, name: 'Ost', checked: false, category: 'Meieri' }),
            item({ id: 3, name: 'Ærfugl-melk', checked: false, category: 'Meieri' }),
          ],
        }),
      );

      renderPage();

      const names = screen.getAllByText(/Yoghurt|Ost|Ærfugl-melk/).map((el) => el.textContent);
      expect(names).toEqual(['Ost', 'Yoghurt', 'Ærfugl-melk']);
    });

    it('toggles an item to checked immediately, and one tap on a checked item unchecks it', async () => {
      mockList(list({ items: [item({ id: 1, checked: false })] }));
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Merk Lettmelk 1 l som kjøpt'));

      expect(toggleMutate).toHaveBeenCalledWith({ id: 1, checked: true }, expect.anything());
    });

    it('toggles when the name is tapped, not only the checkbox itself (T18 F1)', async () => {
      mockList(list({ items: [item({ id: 1, name: 'Lettmelk 1 l', checked: false })] }));
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByText('Lettmelk 1 l'));

      expect(toggleMutate).toHaveBeenCalledWith({ id: 1, checked: true }, expect.anything());
    });

    it('opens inline editing from the pencil button, not by tapping the name (T32 review F1)', async () => {
      mockList(list({ items: [item({ id: 1, name: 'Lettmelk 1 l', checked: false })] }));
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Rediger Lettmelk 1 l'));

      expect(toggleMutate).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Navn')).toHaveValue('Lettmelk 1 l');
      expect(screen.getByLabelText('Antall')).toBeInTheDocument();
    });

    it('does not toggle when "Fjern" is tapped (T18 F1)', async () => {
      mockList(list({ items: [item({ id: 1, name: 'Lettmelk 1 l', checked: false })] }));
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Fjern Lettmelk 1 l'));

      expect(toggleMutate).not.toHaveBeenCalled();
    });

    it('reverts and shows a toast when toggling fails', async () => {
      toggleMutate.mockImplementation((_body, options) => {
        options?.onError?.(new Error('nettverksfeil'));
      });
      mockList(list({ items: [item({ id: 1, checked: false })] }));
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Merk Lettmelk 1 l som kjøpt'));

      expect(screen.getByRole('status')).toHaveTextContent('Noe gikk galt');
    });

    describe('inline editing (T32)', () => {
      it('sends only the changed fields, keeps checked state and category untouched, and shows a toast', async () => {
        mockList(
          list({
            items: [
              item({
                id: 1,
                name: 'Lettmelk 1 l',
                quantityText: '1 stk',
                checked: true,
                category: 'Meieri',
              }),
            ],
          }),
        );
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByLabelText('Rediger Lettmelk 1 l'));
        await user.clear(screen.getByLabelText('Navn'));
        await user.type(screen.getByLabelText('Navn'), 'Lettmelk 1,5 l');
        await user.click(screen.getByRole('button', { name: 'Lagre' }));

        expect(updateItemMutate).toHaveBeenCalledWith(
          { id: 1, name: 'Lettmelk 1,5 l' },
          expect.anything(),
        );
      });

      it('rejects an empty name inline and sends nothing', async () => {
        mockList(list({ items: [item({ id: 1, name: 'Lettmelk 1 l' })] }));
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByLabelText('Rediger Lettmelk 1 l'));
        await user.clear(screen.getByLabelText('Navn'));
        await user.click(screen.getByRole('button', { name: 'Lagre' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Navnet kan ikke være tomt');
        expect(updateItemMutate).not.toHaveBeenCalled();
      });

      it('clearing the quantity field sends quantityText: null', async () => {
        mockList(list({ items: [item({ id: 1, name: 'Lettmelk 1 l', quantityText: '1 stk' })] }));
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByLabelText('Rediger Lettmelk 1 l'));
        await user.clear(screen.getByLabelText('Antall'));
        await user.click(screen.getByRole('button', { name: 'Lagre' }));

        expect(updateItemMutate).toHaveBeenCalledWith(
          { id: 1, quantityText: null },
          expect.anything(),
        );
      });

      it('"Avbryt" discards the edit without sending anything', async () => {
        mockList(list({ items: [item({ id: 1, name: 'Lettmelk 1 l' })] }));
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByLabelText('Rediger Lettmelk 1 l'));
        await user.clear(screen.getByLabelText('Navn'));
        await user.type(screen.getByLabelText('Navn'), 'Noe annet');
        await user.click(screen.getByRole('button', { name: 'Avbryt' }));

        expect(updateItemMutate).not.toHaveBeenCalled();
        expect(screen.getByText('Lettmelk 1 l')).toBeInTheDocument();
        expect(screen.queryByLabelText('Navn')).not.toBeInTheDocument();
      });
    });

    it('adds an item from a search result with its product id', async () => {
      vi.mocked(useProductSearch).mockReturnValue({
        data: [product({ id: 5, name: 'Kaffe' })],
      } as unknown as ReturnType<typeof useProductSearch>);
      mockList(list({ items: [] }));
      renderPage();
      const user = userEvent.setup();

      const input = screen.getByLabelText('Legg til vare');
      await user.type(input, 'Kaf');
      await user.click(screen.getByRole('button', { name: 'Kaffe' }));

      expect(createItemMutate).toHaveBeenCalledWith(
        { name: 'Kaffe', productId: 5 },
        expect.anything(),
      );
    });

    it('adds a free-text item with no product id', async () => {
      mockList(list({ items: [] }));
      renderPage();
      const user = userEvent.setup();

      const input = screen.getByLabelText('Legg til vare');
      await user.type(input, 'Handlenett');
      await user.click(screen.getByRole('button', { name: 'Legg til «Handlenett»' }));

      expect(createItemMutate).toHaveBeenCalledWith(
        { name: 'Handlenett', productId: undefined },
        expect.anything(),
      );
    });

    describe('removing an item (T31)', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      it('hides the row at once and shows "Angre" instead of deleting immediately', () => {
        mockList(list({ items: [item({ id: 1, name: 'Kaffe' })] }));
        renderPage();

        act(() => {
          fireEvent.click(screen.getByLabelText('Fjern Kaffe'));
        });

        expect(screen.queryByText('Kaffe')).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('«Kaffe» fjernet');
        expect(screen.getByRole('button', { name: 'Angre' })).toBeInTheDocument();
        expect(deleteItemMutate).not.toHaveBeenCalled();
      });

      it('"Angre" brings the row back and sends nothing', () => {
        mockList(list({ items: [item({ id: 1, name: 'Kaffe' })] }));
        renderPage();

        act(() => {
          fireEvent.click(screen.getByLabelText('Fjern Kaffe'));
        });
        act(() => {
          fireEvent.click(screen.getByRole('button', { name: 'Angre' }));
        });

        expect(screen.getByText('Kaffe')).toBeInTheDocument();
        act(() => {
          vi.advanceTimersByTime(6000);
        });
        expect(deleteItemMutate).not.toHaveBeenCalled();
      });

      it('sends the delete once 6 seconds pass without "Angre"', () => {
        mockList(list({ items: [item({ id: 1, name: 'Kaffe' })] }));
        renderPage();

        act(() => {
          fireEvent.click(screen.getByLabelText('Fjern Kaffe'));
        });
        act(() => {
          vi.advanceTimersByTime(6000);
        });

        expect(deleteItemMutate).toHaveBeenCalledWith(1, expect.anything());
      });

      it('removing a second item flushes the first one immediately', () => {
        mockList(
          list({
            items: [item({ id: 1, name: 'Kaffe' }), item({ id: 2, name: 'Banan', position: 2 })],
          }),
        );
        renderPage();

        act(() => {
          fireEvent.click(screen.getByLabelText('Fjern Kaffe'));
        });
        act(() => {
          fireEvent.click(screen.getByLabelText('Fjern Banan'));
        });

        expect(deleteItemMutate).toHaveBeenCalledTimes(1);
        expect(deleteItemMutate).toHaveBeenCalledWith(1, expect.anything());
      });

      it('unmounting the list view flushes a pending removal', () => {
        mockList(list({ items: [item({ id: 1, name: 'Kaffe' })] }));
        const { rerender } = render(
          <ToastProvider>
            <MemoryRouter>
              <ShoppingListPage />
            </MemoryRouter>
          </ToastProvider>,
        );

        act(() => {
          fireEvent.click(screen.getByLabelText('Fjern Kaffe'));
        });
        expect(deleteItemMutate).not.toHaveBeenCalled();

        mockNoList();
        mockSuggestions([]);
        rerender(
          <ToastProvider>
            <MemoryRouter>
              <ShoppingListPage />
            </MemoryRouter>
          </ToastProvider>,
        );

        expect(deleteItemMutate).toHaveBeenCalledWith(1, expect.anything());
      });

      it('a failed delete unhides the row and shows the error toast', () => {
        deleteItemMutate.mockImplementation((_id, options) => {
          options?.onError?.(new Error('nettverksfeil'));
        });
        mockList(list({ items: [item({ id: 1, name: 'Kaffe' })] }));
        renderPage();

        act(() => {
          fireEvent.click(screen.getByLabelText('Fjern Kaffe'));
        });
        act(() => {
          vi.advanceTimersByTime(6000);
        });

        expect(screen.getByText('Kaffe')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Noe gikk galt');
      });
    });

    it('completes the list at once, with no confirmation (T31)', async () => {
      mockList(list());
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Ferdig handlet' }));

      expect(completeMutate).toHaveBeenCalledWith(undefined, expect.anything());
    });

    it('shows "Handleturen er fullført" with "Angre" that reopens the list (T31)', async () => {
      completeMutate.mockImplementation((_body, options) => {
        options?.onSuccess?.();
      });
      mockList(list());
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Ferdig handlet' }));

      expect(screen.getByRole('status')).toHaveTextContent('Handleturen er fullført');
      await user.click(screen.getByRole('button', { name: 'Angre' }));

      expect(reopenMutate).toHaveBeenCalledWith(undefined, expect.anything());
    });

    it('flushes a pending removal before completing, so only the completion toast shows (T31 review F1)', () => {
      vi.useFakeTimers();
      completeMutate.mockImplementation((_body, options) => {
        options?.onSuccess?.();
      });
      mockList(list({ items: [item({ id: 1, name: 'Kaffe' })] }));
      renderPage();

      act(() => {
        fireEvent.click(screen.getByLabelText('Fjern Kaffe'));
      });
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Ferdig handlet' }));
      });

      expect(deleteItemMutate).toHaveBeenCalledWith(1, expect.anything());
      expect(completeMutate).toHaveBeenCalledWith(undefined, expect.anything());
      const deleteOrder = deleteItemMutate.mock.invocationCallOrder[0]!;
      const completeOrder = completeMutate.mock.invocationCallOrder[0]!;
      expect(deleteOrder).toBeLessThan(completeOrder);

      expect(screen.getByRole('status')).toHaveTextContent('Handleturen er fullført');
      expect(screen.queryByText('Noe gikk galt')).not.toBeInTheDocument();
    });

    it('returns to the suggestions preview once the list completes (T18 acceptance)', async () => {
      completeMutate.mockImplementation((_body, options) => {
        options?.onSuccess?.();
      });
      mockList(list());
      mockSuggestions([]);
      const { rerender } = render(
        <ToastProvider>
          <MemoryRouter>
            <ShoppingListPage />
          </MemoryRouter>
        </ToastProvider>,
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Ferdig handlet' }));
      expect(completeMutate).toHaveBeenCalledOnce();

      mockNoList();
      rerender(
        <ToastProvider>
          <MemoryRouter>
            <ShoppingListPage />
          </MemoryRouter>
        </ToastProvider>,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Lag handleliste' })).toBeInTheDocument();
      });
    });

    it('deletes the list after confirmation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      mockList(list());
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Slett listen' }));

      expect(deleteListMutate).toHaveBeenCalledWith(undefined, expect.anything());
    });

    it('does not delete the list when the confirmation is dismissed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      mockList(list());
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Slett listen' }));

      expect(deleteListMutate).not.toHaveBeenCalled();
    });

    it('cancels a pending removal instead of sending it when the list itself is deleted (T31 review F1)', () => {
      vi.useFakeTimers();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      mockList(list({ items: [item({ id: 1, name: 'Kaffe' })] }));
      renderPage();

      act(() => {
        fireEvent.click(screen.getByLabelText('Fjern Kaffe'));
      });
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Slett listen' }));
      });

      expect(deleteListMutate).toHaveBeenCalledWith(undefined, expect.anything());
      expect(deleteItemMutate).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(deleteItemMutate).not.toHaveBeenCalled();
    });

    describe('refreshing suggestions (T34)', () => {
      it('shows "1 vare lagt til" when one new item is added', async () => {
        const currentList = list({ items: [item({ id: 1, name: 'Kaffe' })] });
        refreshMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.({
            ...currentList,
            items: [...currentList.items, item({ id: 2, name: 'Lettmelk 1 l' })],
          });
        });
        mockList(currentList);
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Oppdater forslag' }));

        expect(screen.getByRole('status')).toHaveTextContent('1 vare lagt til');
      });

      it('shows "3 varer lagt til" when three new items are added', async () => {
        const currentList = list({ items: [item({ id: 1, name: 'Kaffe' })] });
        refreshMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.({
            ...currentList,
            items: [
              ...currentList.items,
              item({ id: 2, name: 'Eple' }),
              item({ id: 3, name: 'Brød' }),
              item({ id: 4, name: 'Kylling' }),
            ],
          });
        });
        mockList(currentList);
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Oppdater forslag' }));

        expect(screen.getByRole('status')).toHaveTextContent('3 varer lagt til');
      });

      it('shows "Ingen nye forslag" when nothing new is added', async () => {
        const currentList = list({ items: [item({ id: 1, name: 'Kaffe' })] });
        refreshMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.(currentList);
        });
        mockList(currentList);
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Oppdater forslag' }));

        expect(screen.getByRole('status')).toHaveTextContent('Ingen nye forslag');
      });

      it('shows the error toast when the refresh fails', async () => {
        refreshMutate.mockImplementation((_body, options) => {
          options?.onError?.(new Error('nettverksfeil'));
        });
        mockList(list());
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Oppdater forslag' }));

        expect(screen.getByRole('status')).toHaveTextContent('Noe gikk galt');
      });
    });

    describe('Foreslå med AI (T37)', () => {
      it('shows a live-updating "Tenker …" label while the call is pending', () => {
        vi.useFakeTimers();
        vi.mocked(useCreateProposal).mockReturnValue({
          mutate: createProposalMutate,
          isPending: true,
        } as unknown as ReturnType<typeof useCreateProposal>);
        mockList(list());

        renderPage();

        expect(screen.getByText('Tenker… (0 s)')).toBeInTheDocument();
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(screen.getByText('Tenker… (2 s)')).toBeInTheDocument();
      });

      it('calls createProposal when "Foreslå med AI" is tapped', async () => {
        mockList(list());
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Foreslå med AI' }));

        expect(createProposalMutate).toHaveBeenCalledWith(undefined, expect.anything());
      });

      it('renders the proposal with every item pre-checked, its reason and a kind chip', async () => {
        createProposalMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.(
            proposal({
              items: [
                proposalItem({ index: 0, name: 'Godteri', kind: 'merkedag' }),
                proposalItem({
                  index: 1,
                  name: 'Lettmelk 1 l',
                  kind: 'vane',
                  reason: 'Kjøpes normalt hver uke',
                }),
              ],
            }),
          );
        });
        mockList(list());
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Foreslå med AI' }));

        expect(screen.getByText('Forslag fra AI')).toBeInTheDocument();
        expect(screen.getByText('Halloween 31. oktober')).toBeInTheDocument();
        expect(screen.getByText('Merkedag')).toBeInTheDocument();
        expect(screen.getByText('Vane')).toBeInTheDocument();
        expect(screen.getByLabelText('Godteri')).toBeChecked();
        expect(screen.getByLabelText('Lettmelk 1 l')).toBeChecked();
        expect(screen.getByRole('button', { name: 'Legg til valgte (2)' })).toBeInTheDocument();
      });

      it('unchecking an item updates the "Legg til valgte" count', async () => {
        createProposalMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.(
            proposal({
              items: [
                proposalItem({ index: 0, name: 'Godteri' }),
                proposalItem({ index: 1, name: 'Lettmelk 1 l' }),
              ],
            }),
          );
        });
        mockList(list());
        renderPage();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Foreslå med AI' }));

        await user.click(screen.getByLabelText('Godteri'));

        expect(screen.getByLabelText('Godteri')).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Legg til valgte (1)' })).toBeInTheDocument();
      });

      it('"Legg til valgte" accepts only the still-checked indexes', async () => {
        createProposalMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.(
            proposal({
              id: 7,
              items: [
                proposalItem({ index: 0, name: 'Godteri' }),
                proposalItem({ index: 1, name: 'Lettmelk 1 l' }),
              ],
            }),
          );
        });
        mockList(list());
        renderPage();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Foreslå med AI' }));
        await user.click(screen.getByLabelText('Godteri'));

        await user.click(screen.getByRole('button', { name: 'Legg til valgte (1)' }));

        expect(acceptProposalMutate).toHaveBeenCalledWith(
          { proposalId: 7, indexes: [1] },
          expect.anything(),
        );
      });

      it('closes the panel once the accept succeeds', async () => {
        createProposalMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.(proposal());
        });
        acceptProposalMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.(list());
        });
        mockList(list());
        renderPage();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Foreslå med AI' }));

        await user.click(screen.getByRole('button', { name: 'Legg til valgte (1)' }));

        expect(screen.queryByText('Forslag fra AI')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Foreslå med AI' })).toBeInTheDocument();
      });

      it('"Avbryt" accepts an empty set of indexes and closes the panel', async () => {
        createProposalMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.(proposal({ id: 3 }));
        });
        acceptProposalMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.(list());
        });
        mockList(list());
        renderPage();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Foreslå med AI' }));

        await user.click(screen.getByRole('button', { name: 'Avbryt' }));

        expect(acceptProposalMutate).toHaveBeenCalledWith(
          { proposalId: 3, indexes: [] },
          expect.anything(),
        );
        expect(screen.queryByText('Forslag fra AI')).not.toBeInTheDocument();
      });

      it('shows the error toast when the proposal call fails', async () => {
        createProposalMutate.mockImplementation((_body, options) => {
          options?.onError?.(new Error('nettverksfeil'));
        });
        mockList(list());
        renderPage();
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Foreslå med AI' }));

        expect(screen.getByRole('status')).toHaveTextContent('Noe gikk galt');
      });

      it('shows the error toast when accepting fails', async () => {
        createProposalMutate.mockImplementation((_body, options) => {
          options?.onSuccess?.(proposal());
        });
        acceptProposalMutate.mockImplementation((_body, options) => {
          options?.onError?.(new Error('nettverksfeil'));
        });
        mockList(list());
        renderPage();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Foreslå med AI' }));

        await user.click(screen.getByRole('button', { name: 'Legg til valgte (1)' }));

        expect(screen.getByRole('status')).toHaveTextContent('Noe gikk galt');
      });
    });
  });
});
