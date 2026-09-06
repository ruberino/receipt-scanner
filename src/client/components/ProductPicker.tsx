import { useEffect, useState, type KeyboardEvent } from 'react';
import type { Product } from '../../shared/schemas.ts';
import { normalizeText } from '../../shared/normalize.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { useProductSearch, useUpdateReceiptLine } from '../api/queries.ts';
import { useToast } from './Toast.tsx';

const DEBOUNCE_MS = 200;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}

type ProductPickerProps = {
  lineId: number;
  receiptId: number;
  currentProduct: { id: number; name: string } | null;
};

export default function ProductPicker({ lineId, receiptId, currentProduct }: ProductPickerProps) {
  const [query, setQuery] = useState(currentProduct?.name ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const { data: results } = useProductSearch(debouncedQuery, isOpen);
  const updateLine = useUpdateReceiptLine(receiptId);
  const { showToast } = useToast();

  function resetQuery() {
    setQuery(currentProduct?.name ?? '');
  }

  const trimmedQuery = query.trim();
  const normalizedQuery = normalizeText(trimmedQuery);
  const hasExactMatch =
    trimmedQuery.length > 0 &&
    (results ?? []).some((product) => normalizeText(product.name) === normalizedQuery);
  const showCreateOption = isOpen && trimmedQuery.length > 0 && !hasExactMatch;

  function selectProduct(product: Product) {
    setQuery(product.name);
    setIsOpen(false);
    updateLine.mutate(
      { lineId, productId: product.id },
      {
        onSuccess: () => showToast('Varen er oppdatert'),
        onError: (mutationError) => {
          showToast(apiErrorMessage(mutationError));
          resetQuery();
        },
      },
    );
  }

  function createProduct() {
    const name = trimmedQuery;
    setIsOpen(false);
    updateLine.mutate(
      { lineId, newProductName: name },
      {
        onSuccess: () => showToast('Varen er oppdatert'),
        onError: (mutationError) => {
          showToast(apiErrorMessage(mutationError));
          resetQuery();
        },
      },
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setIsOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const firstResult = results?.[0];
      if (firstResult) {
        selectProduct(firstResult);
      } else if (showCreateOption) {
        createProduct();
      }
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-label="Vare"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder="Søk etter vare …"
        className="min-h-11 w-full rounded border border-gray-400 px-3 py-2"
      />
      {isOpen && (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 w-full rounded border border-gray-300 bg-white shadow-lg"
        >
          {(results ?? []).map((product) => (
            <li key={product.id} role="option" aria-selected={currentProduct?.id === product.id}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectProduct(product)}
                className="min-h-11 w-full px-3 py-2 text-left hover:bg-gray-100"
              >
                {product.name}
              </button>
            </li>
          ))}
          {showCreateOption && (
            <li role="option">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={createProduct}
                className="min-h-11 w-full px-3 py-2 text-left font-medium text-blue-600 hover:bg-gray-100"
              >
                Opprett «{trimmedQuery}»
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
