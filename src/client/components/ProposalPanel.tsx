import { useEffect, useState } from 'react';
import type { ShoppingListProposal } from '../../shared/schemas.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { useAcceptProposal, useCreateProposal } from '../api/queries.ts';
import { useToast } from './Toast.tsx';

const KIND_LABELS: Record<string, string> = {
  sesong: 'Sesong',
  merkedag: 'Merkedag',
  variasjon: 'Variasjon',
  vane: 'Vane',
};

/** A call may take 20–60 s (T37); a live-updating label reassures the user something is happening. */
function ThinkingLabel() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return <>Tenker… ({seconds} s)</>;
}

/**
 * `Foreslå med AI` (T37, ADR-0016): a button that calls the LLM for a proposal, then a panel with
 * every item pre-checked so the user unchecks what they do not want before adding the rest.
 * `Avbryt` records an accept with no indexes, so every item counts as rejected for the next call.
 */
export default function ProposalPanel({ listId }: { listId: number }) {
  const createProposal = useCreateProposal(listId);
  const acceptProposal = useAcceptProposal(listId);
  const { showToast } = useToast();
  const [proposal, setProposal] = useState<ShoppingListProposal | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());

  function handlePropose() {
    createProposal.mutate(undefined, {
      onSuccess: (created) => {
        setProposal(created);
        setSelectedIndexes(new Set(created.items.map((item) => item.index)));
      },
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  function toggleIndex(index: number) {
    setSelectedIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function resolve(indexes: number[]) {
    if (proposal === null) {
      return;
    }
    acceptProposal.mutate(
      { proposalId: proposal.id, indexes },
      {
        onSuccess: () => setProposal(null),
        onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
      },
    );
  }

  if (proposal !== null) {
    return (
      <div className="stack">
        <h2 className="eyebrow">Forslag fra AI</h2>
        <ul className="flex flex-col">
          {proposal.items.map((item) => (
            <li key={item.index} className="flex items-center gap-3">
              <label className="flex min-h-12 flex-1 items-start gap-3 py-2">
                <input
                  type="checkbox"
                  checked={selectedIndexes.has(item.index)}
                  onChange={() => toggleIndex(item.index)}
                  aria-label={item.name}
                  className="mt-1 h-5 w-5 flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    {item.name}
                    {item.quantityText !== null && (
                      <span className="meta sep">{item.quantityText}</span>
                    )}
                  </p>
                  <p className="meta">{item.reason}</p>
                </div>
              </label>
              <span className="chip flex-shrink-0">{KIND_LABELS[item.kind] ?? item.kind}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={() => resolve([...selectedIndexes])}

            disabled={acceptProposal.isPending}
            className="btn btn-primary flex-1"
          >
            Legg til valgte ({selectedIndexes.size})
          </button>
          <button
            type="button"
            onClick={() => resolve([])}
            disabled={acceptProposal.isPending}
            className="btn btn-secondary"
          >
            Avbryt
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handlePropose}
      disabled={createProposal.isPending}
      className="btn btn-secondary"
    >
      {createProposal.isPending ? <ThinkingLabel /> : 'Foreslå med AI'}
    </button>
  );
}
