/** @vitest-environment jsdom */
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../src/shared/schemas.ts';
import ProductsPage from '../../src/client/pages/ProductsPage.tsx';

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return { ...actual, useProducts: vi.fn() };
});

const { useProducts } = await import('../../src/client/api/queries.ts');

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Lettmelk 1 l',
    category: 'Meieri',
    suppressed: false,
    timesBought: 4,
    lastBought: '2026-09-01',
    medianIntervalDays: 7,
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

function renderProductsPage() {
  render(
    <MemoryRouter initialEntries={['/products']}>
      <ProductsPage />
    </MemoryRouter>,
  );
}

describe('ProductsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
});
