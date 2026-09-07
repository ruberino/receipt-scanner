/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ShoppingList } from '../../src/shared/schemas.ts';
import ShoppingListDetailPage from '../../src/client/pages/ShoppingListDetailPage.tsx';

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return {
    ...actual,
    useShoppingListDetail: vi.fn(),
  };
});

const { useShoppingListDetail } = await import('../../src/client/api/queries.ts');

function list(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: 9,
    weekStart: '2026-08-31',
    status: 'done',
    createdAt: '2026-08-31T00:00:00.000Z',
    completedAt: '2026-09-07T12:00:00.000Z',
    items: [],
    receipts: [],
    trip: null,
    ...overrides,
  };
}

function mockList(theList: ShoppingList | undefined, extra: Record<string, unknown> = {}) {
  vi.mocked(useShoppingListDetail).mockReturnValue({
    data: theList,
    isPending: false,
    isError: false,
    ...extra,
  } as unknown as ReturnType<typeof useShoppingListDetail>);
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/shopping-lists/9']}>
      <Routes>
        <Route path="/shopping-lists/:id" element={<ShoppingListDetailPage />} />
        <Route path="/" element={<p>Handleliste-siden</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ShoppingListDetailPage (T39)', () => {
  it('shows a loading state before the first fetch resolves', () => {
    mockList(undefined, { isPending: true, isError: false });

    renderPage();

    expect(screen.getByText('Laster …')).toBeInTheDocument();
  });

  it('shows an error state on failure', () => {
    mockList(undefined, { isPending: false, isError: true });

    renderPage();

    expect(screen.getByText('Fant ikke handlelisten.')).toBeInTheDocument();
  });

  it('redirects an open list to "/"', () => {
    mockList(list({ status: 'open' }));

    renderPage();

    expect(screen.getByText('Handleliste-siden')).toBeInTheDocument();
  });

  it('shows the week number and the completion date', () => {
    mockList(list({ weekStart: '2026-08-31', completedAt: '2026-09-07T12:00:00.000Z' }));

    renderPage();

    expect(screen.getByText('Handleliste uke 36')).toBeInTheDocument();
    expect(screen.getByText(/Fullført/)).toBeInTheDocument();
  });

  it('links the receipts as "store, date, total"', () => {
    mockList(
      list({
        receipts: [
          {
            id: 42,
            status: 'done',
            storeName: 'Kiwi',
            purchasedAt: '2026-09-07',
            totalOre: 41200,
            lineCount: 5,
            warnings: [],
            errorMessage: null,
            possibleDuplicateOf: null,
            reviewedAt: null,
            createdAt: '2026-09-07T00:00:00.000Z',
            updatedAt: '2026-09-07T00:00:00.000Z',
            shoppingListId: 9,
          },
        ],
      }),
    );

    renderPage();

    const link = screen.getByRole('link', { name: /Kiwi, 7\. sep\., 412,00\s*kr/ });
    expect(link).toHaveAttribute('href', '/receipts/42');
  });

  it('shows the null-trip message and how to link a receipt', () => {
    mockList(list({ trip: null }));

    renderPage();

    expect(
      screen.getByText('Ingen kvittering er knyttet til denne listen ennå.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/kvitteringssiden/)).toBeInTheDocument();
    expect(screen.queryByText('Handleturen')).not.toBeInTheDocument();
  });

  it('renders the three groups with counts, source chips, and Avkrysset for a checked-but-not-bought item', () => {
    mockList(
      list({
        trip: {
          planned: [
            {
              itemId: 1,
              name: 'Lettmelk 1 l',
              quantityText: '2 stk',
              source: 'suggested',
              checked: false,
              status: 'bought',
            },
            {
              itemId: 2,
              name: 'Godteri',
              quantityText: null,
              source: 'ai',
              checked: false,
              status: 'bought',
            },
            {
              itemId: 3,
              name: 'Brød',
              quantityText: null,
              source: 'manual',
              checked: true,
              status: 'notBought',
            },
          ],
          unplanned: [
            { productId: 5, name: 'Banan', quantity: 6, unit: 'stk' },
            { productId: null, name: 'Kjeks', quantity: 1, unit: null },
          ],
          counts: { planned: 3, bought: 2, notBought: 1, unplanned: 2 },
          receiptIds: [42],
        },
      }),
    );

    renderPage();

    expect(screen.getByText('Handleturen')).toBeInTheDocument();
    expect(screen.getByText('Kjøpt som planlagt (2)')).toBeInTheDocument();
    expect(screen.getByText('Ikke kjøpt (1)')).toBeInTheDocument();
    expect(screen.getByText('Utenom lista (2)')).toBeInTheDocument();

    expect(screen.getByText('Lettmelk 1 l')).toBeInTheDocument();
    expect(screen.getByText('Forslag')).toBeInTheDocument();
    expect(screen.getByText('Godteri')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('Brød')).toBeInTheDocument();
    expect(screen.getByText('Manuell')).toBeInTheDocument();
    expect(screen.getByText('Avkrysset')).toBeInTheDocument();

    const productLink = screen.getByRole('link', { name: 'Banan' });
    expect(productLink).toHaveAttribute('href', '/products/5');
    expect(screen.getByText('Kjeks')).toBeInTheDocument();
  });
});
