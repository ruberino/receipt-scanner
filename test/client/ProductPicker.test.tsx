/** @vitest-environment jsdom */
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../src/shared/schemas.ts';
import { ApiRequestError } from '../../src/client/api/client.ts';
import ProductPicker from '../../src/client/components/ProductPicker.tsx';
import { ToastProvider } from '../../src/client/components/Toast.tsx';

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return { ...actual, useProductSearch: vi.fn(), useUpdateReceiptLine: vi.fn() };
});

const { useProductSearch, useUpdateReceiptLine } = await import('../../src/client/api/queries.ts');

function product(id: number, name: string): Product {
  return {
    id,
    name,
    category: null,
    suppressed: false,
    timesBought: 1,
    lastBought: null,
    medianIntervalDays: null,
    parentId: null,
    variantCount: 0,
  };
}

function mockSearchResults(results: Product[]) {
  vi.mocked(useProductSearch).mockReturnValue({
    data: results,
  } as unknown as ReturnType<typeof useProductSearch>);
}

function renderPicker(currentProduct: { id: number; name: string } | null = null) {
  render(
    <ToastProvider>
      <ProductPicker lineId={1} receiptId={10} currentProduct={currentProduct} />
    </ToastProvider>,
  );
}

describe('ProductPicker', () => {
  let mutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mutate = vi.fn();
    vi.mocked(useUpdateReceiptLine).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateReceiptLine>);
    mockSearchResults([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces the search query by 200ms', () => {
    renderPicker();
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'Mel' } });

    expect(useProductSearch).toHaveBeenLastCalledWith('', true);

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(useProductSearch).toHaveBeenLastCalledWith('', true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(useProductSearch).toHaveBeenLastCalledWith('Mel', true);
  });

  it('only searches while the dropdown is open', () => {
    renderPicker();
    const input = screen.getByRole('combobox');

    expect(useProductSearch).toHaveBeenLastCalledWith('', false);

    fireEvent.focus(input);
    expect(useProductSearch).toHaveBeenLastCalledWith('', true);

    fireEvent.blur(input);
    expect(useProductSearch).toHaveBeenLastCalledWith('', false);
  });

  it('shows the create option only when no exact normalized match exists', () => {
    mockSearchResults([product(1, 'Lettmelk 1 l')]);
    renderPicker();
    const input = screen.getByRole('combobox');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'lettmelk, 1 L' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.queryByText(/Opprett/)).not.toBeInTheDocument();
  });

  it('shows the create option when there is no exact match', () => {
    mockSearchResults([product(1, 'Lettmelk 1 l')]);
    renderPicker();
    const input = screen.getByRole('combobox');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Helt ny vare' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText('Opprett «Helt ny vare»')).toBeInTheDocument();
  });

  it('selects an existing product through the update-line mutation', () => {
    mockSearchResults([product(5, 'Kaffe')]);
    renderPicker();
    const input = screen.getByRole('combobox');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Kaf' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Kaffe' }));

    expect(mutate).toHaveBeenCalledWith({ lineId: 1, productId: 5 }, expect.anything());
  });

  it('creates a new product through the update-line mutation', () => {
    mockSearchResults([]);
    renderPicker();
    const input = screen.getByRole('combobox');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Helt ny vare' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Opprett «Helt ny vare»' }));

    expect(mutate).toHaveBeenCalledWith(
      { lineId: 1, newProductName: 'Helt ny vare' },
      expect.anything(),
    );
  });

  it('shows a toast and resets the input to the previous name when the selection is rejected', () => {
    mutate.mockImplementation((_body, options) => {
      options?.onError?.(
        new ApiRequestError(409, {
          code: 'CONFLICT',
          message: 'Kvitteringen er ikke ferdig behandlet',
          requestId: 'x',
        }),
      );
    });
    mockSearchResults([product(5, 'Kaffe')]);
    renderPicker({ id: 1, name: 'Lettmelk 1 l' });
    const input = screen.getByRole('combobox');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Kaf' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Kaffe' }));

    expect(screen.getByRole('status')).toHaveTextContent('Kvitteringen er ikke ferdig behandlet');
    expect(input).toHaveValue('Lettmelk 1 l');
  });
});
