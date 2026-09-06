import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PRODUCT_CATEGORIES, type ProductCategory } from '../../shared/categories.ts';
import type { Product, ProductDetail } from '../../shared/schemas.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { formatDate, formatOre, formatQuantity } from '../lib/format.ts';
import { useDebouncedValue } from '../lib/useDebouncedValue.ts';
import {
  useDeleteProductAlias,
  useMergeProduct,
  useProductDetail,
  useProducts,
  useUpdateProduct,
} from '../api/queries.ts';
import { useToast } from '../components/Toast.tsx';

const DEBOUNCE_MS = 200;

function MergeSearch({ product, onDone }: { product: ProductDetail; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const { data: results } = useProducts({ q: debouncedQuery });
  const merge = useMergeProduct(product.id);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const candidates = (results ?? []).filter((candidate) => candidate.id !== product.id);

  function handlePick(target: Product) {
    const confirmed = window.confirm(
      `Slå sammen «${product.name}» med «${target.name}»? Dette kan ikke angres.`,
    );
    if (!confirmed) {
      return;
    }
    merge.mutate(target.id, {
      onSuccess: () => navigate(`/products/${target.id}`),
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="merge-search" className="text-sm font-medium">
        Slå sammen med
      </label>
      <input
        id="merge-search"
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Søk etter vare …"
        className="min-h-11 rounded border border-gray-400 px-3 py-2"
        autoFocus
      />
      {candidates.length > 0 && (
        <ul className="rounded border border-gray-300">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => handlePick(candidate)}
                disabled={merge.isPending}
                className="min-h-11 w-full px-3 py-2 text-left hover:bg-gray-100 disabled:opacity-50"
              >
                {candidate.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onDone}
        className="min-h-11 self-start text-sm text-gray-600 underline"
      >
        Avbryt
      </button>
    </div>
  );
}

function AliasRow({ alias }: { alias: ProductDetail['aliases'][number] }) {
  const deleteAlias = useDeleteProductAlias();
  const { showToast } = useToast();

  function handleDelete() {
    deleteAlias.mutate(alias.id, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <li className="flex items-center justify-between gap-2 border-b border-gray-200 py-2">
      <span className="text-sm">{alias.alias}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{alias.source === 'user' ? 'Bruker' : 'KI'}</span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteAlias.isPending}
          className="min-h-11 px-2 text-sm text-red-600 disabled:opacity-50"
        >
          Slett
        </button>
      </div>
    </li>
  );
}

export default function ProductPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data, isPending, isError } = useProductDetail(id);

  if (isPending) {
    return <p className="p-4">Laster …</p>;
  }

  if (isError || !data) {
    return <p className="p-4">Fant ikke varen.</p>;
  }

  // Keyed on the product's id so navigating between products (e.g. after a merge) remounts this
  // view instead of keeping the previous product's name/category state, the same reasoning as
  // ReceiptHeader's key={data.id} in ReceiptPage.tsx.
  return <ProductDetailView key={data.id} product={data} />;
}

function ProductDetailView({ product }: { product: ProductDetail }) {
  const updateProduct = useUpdateProduct(product.id);
  const { showToast } = useToast();

  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState<ProductCategory>(
    (product.category as ProductCategory | null) ?? 'Annet',
  );
  const [isMerging, setIsMerging] = useState(false);
  // Optimistic, like the shopping list's check-off (architecture.md 10): checked is bound to this
  // instead of product.suppressed directly, so the checkbox flips immediately instead of snapping
  // back to its old state until the mutation round-trips and the query refetches.
  const [suppressed, setSuppressed] = useState(product.suppressed);

  function handleSave() {
    updateProduct.mutate(
      { name, category },
      {
        onSuccess: () => showToast('Lagret'),
        onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
      },
    );
  }

  function handleToggleSuppressed() {
    const next = !suppressed;
    setSuppressed(next);
    updateProduct.mutate(
      { suppressed: next },
      {
        onError: (mutationError) => {
          setSuppressed(!next);
          showToast(apiErrorMessage(mutationError));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <label htmlFor="product-name" className="text-sm font-medium">
        Navn
      </label>
      <input
        id="product-name"
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="min-h-11 rounded border border-gray-400 px-3 py-2"
      />

      <label htmlFor="product-category" className="text-sm font-medium">
        Kategori
      </label>
      <select
        id="product-category"
        value={category}
        onChange={(event) => setCategory(event.target.value as ProductCategory)}
        className="min-h-11 rounded border border-gray-400 px-3 py-2"
      >
        {PRODUCT_CATEGORIES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={handleSave}
        disabled={updateProduct.isPending}
        className="min-h-11 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        Lagre
      </button>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={suppressed} onChange={handleToggleSuppressed} />
        Ikke foreslå
      </label>

      {isMerging ? (
        <MergeSearch product={product} onDone={() => setIsMerging(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setIsMerging(true)}
          className="min-h-11 self-start rounded border border-gray-400 px-4 py-2 font-medium"
        >
          Slå sammen med…
        </button>
      )}

      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Alias</h2>
        {product.aliases.length === 0 ? (
          <p className="text-sm text-gray-500">Ingen alias.</p>
        ) : (
          <ul>
            {product.aliases.map((alias) => (
              <AliasRow key={alias.id} alias={alias} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Kjøpshistorikk</h2>
        {product.purchases.length === 0 ? (
          <p className="text-sm text-gray-500">Ingen kjøp registrert.</p>
        ) : (
          <ul>
            {product.purchases.map((purchase, index) => (
              <li key={`${purchase.receiptId}-${index}`} className="border-b border-gray-200 py-2">
                <Link to={`/receipts/${purchase.receiptId}`} className="flex flex-col gap-0.5">
                  <span className="text-sm">
                    {formatDate(purchase.date)}
                    {purchase.storeName !== null ? ` — ${purchase.storeName}` : ''}
                  </span>
                  <span className="text-sm text-gray-600">
                    {formatQuantity(purchase.quantity, purchase.unit)} ·{' '}
                    {formatOre(purchase.totalOre)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
