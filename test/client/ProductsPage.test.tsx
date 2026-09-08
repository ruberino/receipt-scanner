/** @vitest-environment jsdom */
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupCandidate, Product } from '../../src/shared/schemas.ts';
import ProductsPage from '../../src/client/pages/ProductsPage.tsx';
import { ToastProvider } from '../../src/client/components/Toast.tsx';

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return {
    ...actual,
    useProducts: vi.fn(),
    useGroupCandidates: vi.fn(),
    useCreateProductGroup: vi.fn(),
  };
});

const { useProducts, useGroupCandidates, useCreateProductGroup } =
  await import('../../src/client/api/queries.ts');

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Lettmelk 1 l',
    category: 'Meieri',
    suppressed: false,
    timesBought: 4,
    lastBought: '2026-09-01',
    medianIntervalDays: 7,
    parentId: null,
    variantCount: 0,
    ...overrides,
  };
}

function mockProducts(products: Product[]) {
  vi.mocked(useProducts).mockReturnValue({
    data: products,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useProducts>);
}

/** `useProducts()` with no arguments is the unfiltered fetch (T40); `useProducts({ q, ... })` is
 * the page's own filtered list. Lets a test give the two calls different results. */
function mockProductsByCall(unfiltered: Product[], filtered: Product[]) {
  vi.mocked(useProducts).mockImplementation(
    (params) =>
      ({
        data: params === undefined ? unfiltered : filtered,
        isPending: false,
        isError: false,
      }) as unknown as ReturnType<typeof useProducts>,
  );
}

function candidate(overrides: Partial<GroupCandidate> = {}): GroupCandidate {
  return { suggestedName: 'Skyr mini', productIds: [1, 2], ...overrides };
}

function renderProductsPage() {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/products']}>
        <ProductsPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('ProductsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(useGroupCandidates).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useGroupCandidates>);
    vi.mocked(useCreateProductGroup).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateProductGroup>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a loading state before the first fetch resolves', () => {
    vi.mocked(useProducts).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useProducts>);

    renderProductsPage();

    expect(screen.getByText('Laster …')).toBeInTheDocument();
  });

  it('shows an empty state with no products', () => {
    mockProducts([]);

    renderProductsPage();

    expect(screen.getByText('Ingen varer funnet.')).toBeInTheDocument();
  });

  it('renders name, category, times bought, last bought and the interval', () => {
    mockProducts([product()]);

    renderProductsPage();

    expect(screen.getByText('Lettmelk 1 l')).toBeInTheDocument();
    expect(screen.getByText('Meieri')).toBeInTheDocument();
    expect(screen.getByText('Kjøpt 4 ganger')).toBeInTheDocument();
    expect(screen.getByText(/^Sist /)).toBeInTheDocument();
    expect(screen.getByText('ca. hver 7. dag')).toBeInTheDocument();
  });

  it('uses singular wording for one purchase and omits last-bought/interval when unknown', () => {
    mockProducts([product({ timesBought: 1, lastBought: null, medianIntervalDays: null })]);

    renderProductsPage();

    expect(screen.getByText('Kjøpt 1 gang')).toBeInTheDocument();
    expect(screen.queryByText(/^Sist /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^ca\. hver /)).not.toBeInTheDocument();
  });

  it('shows a "Skjult" badge only for suppressed products', () => {
    mockProducts([
      product({ id: 1, name: 'Synlig vare', suppressed: false }),
      product({ id: 2, name: 'Skjult vare', suppressed: true }),
    ]);

    renderProductsPage();

    expect(screen.getByText('Skjult')).toBeInTheDocument();
    expect(screen.getAllByText('Skjult')).toHaveLength(1);
  });

  it('links each row to its product', () => {
    mockProducts([product({ id: 7 })]);

    renderProductsPage();

    expect(screen.getByRole('link', { name: /Lettmelk 1 l/ })).toHaveAttribute(
      'href',
      '/products/7',
    );
  });

  it('debounces the search query by 200ms', () => {
    mockProducts([]);
    renderProductsPage();
    const input = screen.getByLabelText('Søk etter vare');

    fireEvent.change(input, { target: { value: 'Mel' } });

    expect(useProducts).toHaveBeenLastCalledWith({ q: '', includeSuppressed: false });

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(useProducts).toHaveBeenLastCalledWith({ q: '', includeSuppressed: false });

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(useProducts).toHaveBeenLastCalledWith({ q: 'Mel', includeSuppressed: false });
  });

  it('toggles "Vis skjulte" through to useProducts', () => {
    mockProducts([]);
    renderProductsPage();

    fireEvent.click(screen.getByLabelText('Vis skjulte'));

    expect(useProducts).toHaveBeenLastCalledWith({ q: '', includeSuppressed: true });
  });

  describe('product groups (T40)', () => {
    it("shows a parent's variant count under its name (F2)", () => {
      mockProducts([
        product({ id: 1, name: 'Skyr mini', variantCount: 2, timesBought: 8 }),
        product({ id: 2, name: 'Skyr mini banan', parentId: 1 }),
      ]);

      renderProductsPage();

      expect(screen.getByText('2 varianter')).toBeInTheDocument();
      expect(screen.queryByText('1 variant')).not.toBeInTheDocument();
    });

    it('indents a child directly under its parent when both are in the result', () => {
      mockProducts([
        product({ id: 1, name: 'Skyr mini', variantCount: 1 }),
        product({ id: 2, name: 'Skyr mini jordbær', parentId: 1 }),
      ]);

      renderProductsPage();

      const childLink = screen.getByRole('link', { name: /Skyr mini jordbær/ });
      expect(childLink.closest('li')).toHaveClass('pl-8');
      expect(screen.queryByText(/variant av/)).not.toBeInTheDocument();
    });

    it('indents every sibling under the same parent, not only the one right after it', () => {
      mockProducts([
        product({ id: 1, name: 'Skyr mini', variantCount: 2 }),
        product({ id: 2, name: 'Skyr mini banan', parentId: 1 }),
        product({ id: 3, name: 'Skyr mini jordbær', parentId: 1 }),
      ]);

      renderProductsPage();

      expect(screen.getByRole('link', { name: /Skyr mini banan/ }).closest('li')).toHaveClass(
        'pl-8',
      );
      expect(screen.getByRole('link', { name: /Skyr mini jordbær/ }).closest('li')).toHaveClass(
        'pl-8',
      );
      expect(screen.queryByText(/variant av/)).not.toBeInTheDocument();
    });

    it('shows a "variant av" line when the parent isn\'t in the filtered result', () => {
      mockProductsByCall(
        [
          product({ id: 1, name: 'Skyr mini' }),
          product({ id: 2, name: 'Skyr mini jordbær', parentId: 1 }),
        ],
        [product({ id: 2, name: 'Skyr mini jordbær', parentId: 1 })],
      );

      renderProductsPage();

      expect(screen.getByText('variant av Skyr mini')).toBeInTheDocument();
      const childLink = screen.getByRole('link', { name: /Skyr mini jordbær/ });
      expect(childLink.closest('li')).not.toHaveClass('pl-8');
    });
  });

  describe('group candidates (T40)', () => {
    beforeEach(() => {
      window.localStorage.clear();
      // userEvent's internal delays need real timers; these tests don't touch the debounced
      // search field, so the suite's own fake timers (for the debounce tests above) are unneeded.
      vi.useRealTimers();
    });

    it('does not show the block when there are no candidates', () => {
      mockProducts([]);

      renderProductsPage();

      expect(screen.queryByText(/Kan være samme vare/)).not.toBeInTheDocument();
    });

    it('shows member names and the suggested group name once opened', async () => {
      mockProducts([
        product({ id: 1, name: 'Skyr mini jordbær' }),
        product({ id: 2, name: 'Skyr mini banan' }),
      ]);
      vi.mocked(useGroupCandidates).mockReturnValue({
        data: [candidate()],
      } as unknown as ReturnType<typeof useGroupCandidates>);
      const user = userEvent.setup();
      renderProductsPage();

      expect(screen.getByText('Kan være samme vare (1)')).toBeInTheDocument();
      await user.click(screen.getByText('Kan være samme vare (1)'));

      expect(
        screen.getByText('Skyr mini jordbær, Skyr mini banan → «Skyr mini»'),
      ).toBeInTheDocument();
    });

    it('creates the group with the edited name and every member id on "Grupper"', async () => {
      mockProducts([
        product({ id: 1, name: 'Skyr mini jordbær' }),
        product({ id: 2, name: 'Skyr mini banan' }),
      ]);
      vi.mocked(useGroupCandidates).mockReturnValue({
        data: [candidate()],
      } as unknown as ReturnType<typeof useGroupCandidates>);
      const mutate = vi.fn();
      vi.mocked(useCreateProductGroup).mockReturnValue({
        mutate,
        isPending: false,
      } as unknown as ReturnType<typeof useCreateProductGroup>);
      const user = userEvent.setup();
      renderProductsPage();
      await user.click(screen.getByText('Kan være samme vare (1)'));

      const nameInput = screen.getByLabelText(
        'Navn på gruppen for Skyr mini jordbær, Skyr mini banan',
      );
      await user.clear(nameInput);
      await user.type(nameInput, 'Skyr');
      await user.click(screen.getByRole('button', { name: 'Grupper' }));

      expect(mutate).toHaveBeenCalledWith({ name: 'Skyr', memberIds: [1, 2] }, expect.anything());
    });

    it('hides a candidate on "Ikke nå" and remembers it in localStorage', async () => {
      mockProducts([
        product({ id: 1, name: 'Skyr mini jordbær' }),
        product({ id: 2, name: 'Skyr mini banan' }),
      ]);
      vi.mocked(useGroupCandidates).mockReturnValue({
        data: [candidate()],
      } as unknown as ReturnType<typeof useGroupCandidates>);
      const user = userEvent.setup();
      renderProductsPage();
      await user.click(screen.getByText('Kan være samme vare (1)'));

      await user.click(screen.getByRole('button', { name: 'Ikke nå' }));

      expect(screen.queryByText(/Kan være samme vare/)).not.toBeInTheDocument();
      expect(window.localStorage.getItem('kvitteringer:dismissed-group-candidates')).toContain(
        '1,2',
      );
    });
  });
});
