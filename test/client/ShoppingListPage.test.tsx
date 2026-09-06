/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Product,
  ShoppingList,
  ShoppingListItem,
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
    useCreateShoppingList: vi.fn(),
    useCreateShoppingListItem: vi.fn(),
    useCompleteShoppingList: vi.fn(),
    useToggleShoppingListItem: vi.fn(),
    useDeleteShoppingListItem: vi.fn(),
    useProductSearch: vi.fn(),
  };
});

const {
  useSuggestions,
  useCurrentShoppingList,
  useCreateShoppingList,
  useCreateShoppingListItem,
  useCompleteShoppingList,
  useToggleShoppingListItem,
  useDeleteShoppingListItem,
  useProductSearch,
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
  let toggleMutate: ReturnType<typeof vi.fn>;
  let deleteItemMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createListMutate = vi.fn();
    createItemMutate = vi.fn();
    completeMutate = vi.fn();
    toggleMutate = vi.fn();
    deleteItemMutate = vi.fn();
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
    vi.mocked(useToggleShoppingListItem).mockReturnValue({
      mutate: toggleMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useToggleShoppingListItem>);
    vi.mocked(useDeleteShoppingListItem).mockReturnValue({
      mutate: deleteItemMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteShoppingListItem>);
    vi.mocked(useProductSearch).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useProductSearch>);
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
  });

  describe('with an open list', () => {
    it('shows unchecked items first and checked items in a collapsed group below', () => {
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
      expect(screen.getByText('1 fullført')).toBeInTheDocument();
      const details = screen.getByText('1 fullført').closest('details');
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute('open');
      expect(screen.getByText('Lettmelk 1 l')).toBeInTheDocument();
    });

    it('toggles an item to checked immediately', async () => {
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

    it('does not toggle when "Fjern" is tapped (T18 F1)', async () => {
      mockList(list({ items: [item({ id: 1, name: 'Lettmelk 1 l', checked: false })] }));
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Fjern Lettmelk 1 l'));

      expect(toggleMutate).not.toHaveBeenCalled();
      expect(deleteItemMutate).toHaveBeenCalledWith(1, expect.anything());
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

    it('removes an item', async () => {
      mockList(list({ items: [item({ id: 1, name: 'Kaffe' })] }));
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Fjern Kaffe'));

      expect(deleteItemMutate).toHaveBeenCalledWith(1, expect.anything());
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

    it('completes the list after confirmation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      mockList(list());
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Ferdig handlet' }));

      expect(completeMutate).toHaveBeenCalledWith(undefined, expect.anything());
    });

    it('does not complete when the confirmation is dismissed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      mockList(list());
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Ferdig handlet' }));

      expect(completeMutate).not.toHaveBeenCalled();
    });

    it('returns to the suggestions preview once the list completes (T18 acceptance)', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
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
  });
});
