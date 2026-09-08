import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PRODUCT_CATEGORIES, type ProductCategory } from '../../shared/categories.ts';
import { normalizeText } from '../../shared/normalize.ts';
import type { Product, ProductDetail } from '../../shared/schemas.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { formatDate, formatOre, formatQuantity } from '../lib/format.ts';
import { useDebouncedValue } from '../lib/useDebouncedValue.ts';
import {
  useAttachProductParent,
  useCreateProductGroup,
  useDeleteProductAlias,
  useDetachProductParent,
  useMergeProduct,
  useProductDetail,
  useProducts,
  useUpdateProduct,
} from '../api/queries.ts';
import { useToast } from '../components/Toast.tsx';

const DEBOUNCE_MS = 200;

function timesBoughtLabel(count: number): string {
  return count === 1 ? '1 gang' : `${count} ganger`;
}

/** The name a new group defaults to when the product being grouped has at least two words, the
 * same heuristic `findGroupCandidates` uses server-side (T40, ADR-0019). */
function suggestedGroupName(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).join(' ');
}

function GroupPicker({ product, onDone }: { product: ProductDetail; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const { data: results } = useProducts({ q: debouncedQuery });
  const attachParent = useAttachProductParent(product.id);
  const createGroup = useCreateProductGroup();
  const { showToast } = useToast();
  const [namingCandidate, setNamingCandidate] = useState<Product | null>(null);
  const [groupName, setGroupName] = useState('');

  const candidates = (results ?? []).filter(
    (candidate) => candidate.id !== product.id && candidate.parentId === null,
  );
  const trimmedQuery = query.trim();
  const hasExactMatch =
    trimmedQuery.length > 0 &&
    candidates.some((candidate) => normalizeText(candidate.name) === normalizeText(trimmedQuery));
  const showCreateOption = trimmedQuery.length > 0 && !hasExactMatch;

  function handlePick(candidate: Product) {
    if (candidate.variantCount > 0) {
      attachParent.mutate(candidate.id, {
        onSuccess: onDone,
        onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
      });
      return;
    }
    setNamingCandidate(candidate);
    setGroupName(suggestedGroupName(product.name));
  }

  function handleCreateGroup() {
    createGroup.mutate(
      {
        name: groupName.trim(),
        memberIds: namingCandidate ? [product.id, namingCandidate.id] : [product.id],
      },
      {
        onSuccess: onDone,
        onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
      },
    );
  }

  function handleCreateSolo() {
    createGroup.mutate(
      { name: trimmedQuery, memberIds: [product.id] },
      {
        onSuccess: onDone,
        onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
      },
    );
  }

  if (namingCandidate) {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor="group-name" className="text-sm font-medium">
          Navn på varegruppen
        </label>
        <input
          id="group-name"
          type="text"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          className="min-h-11 rounded border border-gray-400 px-3 py-2"
          autoFocus
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCreateGroup}
            disabled={createGroup.isPending || groupName.trim().length === 0}
            className="min-h-11 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Lag gruppe
          </button>
          <button
            type="button"
            onClick={() => setNamingCandidate(null)}
            className="min-h-11 text-sm text-gray-600 underline"
          >
            Avbryt
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="group-search" className="text-sm font-medium">
        Legg i gruppe
      </label>
      <input
        id="group-search"
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
                disabled={attachParent.isPending}
                className="min-h-11 w-full px-3 py-2 text-left hover:bg-gray-100 disabled:opacity-50"
              >
                {candidate.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showCreateOption && (
        <button
          type="button"
          onClick={handleCreateSolo}
          disabled={createGroup.isPending}
          className="min-h-11 self-start px-3 py-2 text-left font-medium text-blue-600 hover:bg-gray-100"
        >
          Opprett «{trimmedQuery}»
        </button>
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

function VaregruppeSection({ product }: { product: ProductDetail }) {
  const [isPicking, setIsPicking] = useState(false);
  const detachParent = useDetachProductParent(product.id);
  const { showToast } = useToast();

  function handleDetach() {
    detachParent.mutate(undefined, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Varegruppe</h2>
      {product.parent !== null ? (
        <div className="flex flex-col gap-2">
          <Link to={`/products/${product.parent.id}`} className="text-sm text-blue-600 underline">
            Variant av «{product.parent.name}»
          </Link>
          <button
            type="button"
            onClick={handleDetach}
            disabled={detachParent.isPending}
            className="min-h-11 self-start rounded border border-gray-400 px-4 py-2 font-medium disabled:opacity-50"
          >
            Fjern fra gruppen
          </button>
        </div>
      ) : product.variantCount > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Varianter ({product.variantCount})</h3>
          <ul>
            {product.variants.map((variant) => (
              <li key={variant.id} className="border-b border-gray-200 py-2">
                <Link to={`/products/${variant.id}`} className="flex flex-col gap-0.5">
                  <span className="text-sm">{variant.name}</span>
                  <span className="text-sm text-gray-600">
                    {timesBoughtLabel(variant.timesBought)}
                    {variant.lastBought !== null ? `, sist ${formatDate(variant.lastBought)}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {product.groupStats !== null && (
            <p className="text-sm text-gray-600">
              Gruppen: kjøpt {timesBoughtLabel(product.groupStats.timesBought)}
              {product.groupStats.lastBought !== null
                ? `, sist ${formatDate(product.groupStats.lastBought)}`
                : ''}
              {product.groupStats.medianIntervalDays !== null
                ? `, ca. hver ${product.groupStats.medianIntervalDays}. dag`
                : ''}
            </p>
          )}
        </div>
      ) : isPicking ? (
        <GroupPicker product={product} onDone={() => setIsPicking(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setIsPicking(true)}
          className="min-h-11 self-start rounded border border-gray-400 px-4 py-2 font-medium"
        >
          Legg i gruppe…
        </button>
      )}
    </div>
  );
}

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
      `Slå sammen «${product.name}» med «${target.name}»? Dette kan ikke angres.\n\n` +
        'Er det varianter av samme vare, bruk Varegruppe i stedet.',
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

      <VaregruppeSection product={product} />

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
