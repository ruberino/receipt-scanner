import { useState } from 'react';
import { Link } from 'react-router';
import type { Product } from '../../shared/schemas.ts';
import { formatRelativeDate } from '../lib/format.ts';
import { useDebouncedValue } from '../lib/useDebouncedValue.ts';
import { useProducts } from '../api/queries.ts';

const DEBOUNCE_MS = 200;

function timesBoughtLabel(count: number): string {
  return count === 1 ? 'Kjøpt 1 gang' : `Kjøpt ${count} ganger`;
}

function ProductRow({ product }: { product: Product }) {
  return (
    <li className="border-b border-gray-200">
      <Link to={`/products/${product.id}`} className="flex flex-col gap-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{product.name}</span>
          {product.suppressed && (
            <span className="whitespace-nowrap rounded-full bg-gray-200 px-2 py-1 text-xs text-gray-700">
              Skjult
            </span>
          )}
        </div>
        <span className="text-sm text-gray-600">{product.category ?? 'Annet'}</span>
        <span className="text-sm text-gray-600">{timesBoughtLabel(product.timesBought)}</span>
        {product.lastBought !== null && (
          <span className="text-sm text-gray-600">
            Sist {formatRelativeDate(product.lastBought)}
          </span>
        )}
        {product.medianIntervalDays !== null && (
          <span className="text-sm text-gray-600">ca. hver {product.medianIntervalDays}. dag</span>
        )}
      </Link>
    </li>
  );
}

export default function ProductsPage() {
  const [query, setQuery] = useState('');
  const [includeSuppressed, setIncludeSuppressed] = useState(false);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const { data, isPending, isError } = useProducts({ q: debouncedQuery, includeSuppressed });

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-4">
        <label htmlFor="product-search" className="text-sm font-medium">
          Søk etter vare
        </label>
        <input
          id="product-search"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Søk etter vare …"
          className="min-h-11 rounded border border-gray-400 px-3 py-2"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeSuppressed}
            onChange={(event) => setIncludeSuppressed(event.target.checked)}
          />
          Vis skjulte
        </label>
      </div>

      {isPending && <p className="p-4">Laster …</p>}
      {isError && <p className="p-4">Noe gikk galt</p>}
      {!isPending && !isError && data.length === 0 && <p className="p-4">Ingen varer funnet.</p>}
      {!isPending && !isError && data.length > 0 && (
        <ul>
          {data.map((product) => (
            <ProductRow key={product.id} product={product} />
          ))}
        </ul>
      )}
    </div>
  );
}
