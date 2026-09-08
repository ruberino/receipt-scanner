import { useState } from 'react';
import { Link } from 'react-router';
import type { GroupCandidate, Product } from '../../shared/schemas.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { formatRelativeDate } from '../lib/format.ts';
import { useDebouncedValue } from '../lib/useDebouncedValue.ts';
import { useCreateProductGroup, useGroupCandidates, useProducts } from '../api/queries.ts';
import { useToast } from '../components/Toast.tsx';

const DEBOUNCE_MS = 200;
const DISMISSED_CANDIDATES_KEY = 'kvitteringer:dismissed-group-candidates';

function timesBoughtLabel(count: number): string {
  return count === 1 ? 'Kjøpt 1 gang' : `Kjøpt ${count} ganger`;
}

function candidateKey(productIds: number[]): string {
  return [...productIds].sort((a, b) => a - b).join(',');
}

function loadDismissedCandidates(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_CANDIDATES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDismissedCandidates(keys: Set<string>): void {
  try {
    window.localStorage.setItem(DISMISSED_CANDIDATES_KEY, JSON.stringify([...keys]));
  } catch {
    // Best-effort only: a private window or a full quota just means the candidate reappears.
  }
}

function ProductRow({
  product,
  parentName,
  indented,
}: {
  product: Product;
  parentName: string | null;
  indented: boolean;
}) {
  return (
    <li className={`border-b border-gray-200 ${indented ? 'pl-8' : ''}`}>
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
        {parentName !== null && !indented && (
          <span className="text-sm text-gray-500">variant av {parentName}</span>
        )}
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

function GroupCandidateRow({
  candidate,
  members,
  onDismiss,
}: {
  candidate: GroupCandidate;
  members: Product[];
  onDismiss: () => void;
}) {
  const [name, setName] = useState(candidate.suggestedName);
  const createGroup = useCreateProductGroup();
  const { showToast } = useToast();
  const memberNames = members.map((member) => member.name).join(', ');

  function handleCreate() {
    createGroup.mutate(
      { name: name.trim(), memberIds: candidate.productIds },
      { onError: (mutationError) => showToast(apiErrorMessage(mutationError)) },
    );
  }

  return (
    <li className="flex flex-col gap-2 border-b border-gray-200 py-3">
      <p className="text-sm">
        {memberNames} → «{candidate.suggestedName}»
      </p>
      <label htmlFor={`candidate-name-${candidateKey(candidate.productIds)}`} className="sr-only">
        Navn på gruppen for {memberNames}
      </label>
      <input
        id={`candidate-name-${candidateKey(candidate.productIds)}`}
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="min-h-11 rounded border border-gray-400 px-3 py-2"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCreate}
          disabled={createGroup.isPending || name.trim().length === 0}
          className="min-h-11 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Grupper
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-11 text-sm text-gray-600 underline"
        >
          Ikke nå
        </button>
      </div>
    </li>
  );
}

function GroupCandidatesSection({ allProducts }: { allProducts: Product[] }) {
  const { data: candidates } = useGroupCandidates();
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissedCandidates());
  const [isOpen, setIsOpen] = useState(false);

  const visible = (candidates ?? []).filter(
    (candidate) => !dismissed.has(candidateKey(candidate.productIds)),
  );

  if (visible.length === 0) {
    return null;
  }

  const productsById = new Map(allProducts.map((product) => [product.id, product]));

  function handleDismiss(candidate: GroupCandidate) {
    const key = candidateKey(candidate.productIds);
    const next = new Set(dismissed).add(key);
    setDismissed(next);
    saveDismissedCandidates(next);
  }

  return (
    <details
      className="border-b border-gray-200 p-4"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">
        Kan være samme vare ({visible.length})
      </summary>
      {isOpen && (
        <ul className="mt-2 flex flex-col">
          {visible.map((candidate) => (
            <GroupCandidateRow
              key={candidateKey(candidate.productIds)}
              candidate={candidate}
              members={candidate.productIds
                .map((id) => productsById.get(id))
                .filter((member): member is Product => member !== undefined)}
              onDismiss={() => handleDismiss(candidate)}
            />
          ))}
        </ul>
      )}
    </details>
  );
}

export default function ProductsPage() {
  const [query, setQuery] = useState('');
  const [includeSuppressed, setIncludeSuppressed] = useState(false);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  // Unfiltered, for the candidates block and for naming a variant's parent when the parent itself
  // is filtered out of `data` by the search text (T40, ADR-0019).
  const { data: allProducts } = useProducts();
  const { data, isPending, isError } = useProducts({ q: debouncedQuery, includeSuppressed });

  return (
    <div className="flex flex-col">
      <GroupCandidatesSection allProducts={allProducts ?? []} />

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
          {data.map((product) => {
            // The server places every child right after its parent, as one block, when both are
            // in the result (T40); a sibling further down that block is still indented, so "both
            // present" is a set membership check, not "is the row right above me my parent".
            const indented =
              product.parentId !== null && data.some((other) => other.id === product.parentId);
            const parentName =
              product.parentId !== null
                ? ((allProducts ?? []).find((candidate) => candidate.id === product.parentId)
                    ?.name ?? null)
                : null;
            return (
              <ProductRow
                key={product.id}
                product={product}
                parentName={parentName}
                indented={indented}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
