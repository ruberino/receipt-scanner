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

function variantCountLabel(count: number): string {
  return count === 1 ? '1 variant' : `${count} varianter`;
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
    <li className={`${indented ? 'pl-8' : ''}`}>
      <Link to={`/products/${product.id}`} className="flex flex-col py-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate">{product.name}</span>
          {product.suppressed && <span className="chip">Skjult</span>}
        </div>
        <p className="meta">
          <span>{product.category ?? 'Annet'}</span>
          {product.variantCount > 0 && (
            <span className="sep">{variantCountLabel(product.variantCount)}</span>
          )}
          {parentName !== null && !indented && <span className="sep">variant av {parentName}</span>}
        </p>
        <p className="meta">
          <span>{timesBoughtLabel(product.timesBought)}</span>
          {product.lastBought !== null && (
            <span className="sep">Sist {formatRelativeDate(product.lastBought)}</span>
          )}
          {product.medianIntervalDays !== null && (
            <span className="sep">ca. hver {product.medianIntervalDays}. dag</span>
          )}
        </p>
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
    <li className="stack py-3">
      <p>
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
        className="field"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCreate}
          disabled={createGroup.isPending || name.trim().length === 0}
          className="btn btn-primary"
        >
          Grupper
        </button>
        <button type="button" onClick={onDismiss} className="btn btn-quiet px-0">
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
    <details onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="disclosure">Kan være samme vare ({visible.length})</summary>
      {isOpen && (
        <ul className="flex flex-col pt-2">
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
    <div className="page">
      <h1 className="page-title">Varer</h1>

      <GroupCandidatesSection allProducts={allProducts ?? []} />

      <div className="stack">
        <label htmlFor="product-search" className="sr-only">
          Søk etter vare
        </label>
        <input
          id="product-search"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Søk etter vare …"
          className="field"
        />
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={includeSuppressed}
            onChange={(event) => setIncludeSuppressed(event.target.checked)}
          />
          Vis skjulte
        </label>
      </div>

      {isPending && <p className="text-ink-muted">Laster …</p>}
      {isError && <p>Noe gikk galt</p>}
      {!isPending && !isError && data.length === 0 && (
        <p className="text-ink-muted">Ingen varer funnet.</p>
      )}
      {!isPending && !isError && data.length > 0 && (
        <ul className="flex flex-col">
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
