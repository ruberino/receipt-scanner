import { useState, type KeyboardEvent } from 'react';
import type { ShoppingList, ShoppingListItem } from '../../shared/schemas.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { useDebouncedValue } from '../lib/useDebouncedValue.ts';
import {
  useCompleteShoppingList,
  useCreateShoppingList,
  useCreateShoppingListItem,
  useCurrentShoppingList,
  useProductSearch,
  useSuggestions,
  useToggleShoppingListItem,
} from '../api/queries.ts';
import ShoppingListItemRow from '../components/ShoppingListItemRow.tsx';
import SuggestionCard from '../components/SuggestionCard.tsx';
import { useToast } from '../components/Toast.tsx';

const DEBOUNCE_MS = 200;

function SuggestionsPreview() {
  const { data: suggestions, isPending, isError } = useSuggestions();
  const createList = useCreateShoppingList();
  const { showToast } = useToast();

  function handleCreate() {
    createList.mutate(undefined, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <button
        type="button"
        onClick={handleCreate}
        disabled={createList.isPending}
        className="min-h-11 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        Lag handleliste
      </button>

      {isPending && <p>Laster …</p>}
      {isError && <p>Noe gikk galt</p>}
      {!isPending && !isError && suggestions.length === 0 && (
        <p className="text-gray-600">Ingen forslag ennå.</p>
      )}
      {!isPending && !isError && suggestions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {suggestions.map((suggestion) => (
            <SuggestionCard key={suggestion.productId} suggestion={suggestion} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddItemField({ listId }: { listId: number }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const { data: results } = useProductSearch(debouncedQuery, isOpen);
  const createItem = useCreateShoppingListItem(listId);
  const { showToast } = useToast();

  function addItem(name: string, productId?: number) {
    const trimmed = name.trim();
    if (trimmed === '') {
      return;
    }
    setQuery('');
    setIsOpen(false);
    createItem.mutate(
      { name: trimmed, productId },
      { onError: (mutationError) => showToast(apiErrorMessage(mutationError)) },
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
        addItem(firstResult.name, firstResult.id);
      } else {
        addItem(query);
      }
    }
  }

  const trimmedQuery = query.trim();

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-label="Legg til vare"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder="Legg til vare …"
        className="min-h-11 w-full rounded border border-gray-400 px-3 py-2"
      />
      {isOpen && (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 w-full rounded border border-gray-300 bg-white shadow-lg"
        >
          {(results ?? []).map((product) => (
            <li key={product.id} role="option">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addItem(product.name, product.id)}
                className="min-h-11 w-full px-3 py-2 text-left hover:bg-gray-100"
              >
                {product.name}
              </button>
            </li>
          ))}
          {trimmedQuery.length > 0 && (
            <li role="option">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addItem(trimmedQuery)}
                className="min-h-11 w-full px-3 py-2 text-left font-medium text-blue-600 hover:bg-gray-100"
              >
                Legg til «{trimmedQuery}»
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function completedLabel(count: number): string {
  return count === 1 ? '1 fullført' : `${count} fullført`;
}

function OpenListView({ list }: { list: ShoppingList }) {
  const completeList = useCompleteShoppingList(list.id);
  const toggle = useToggleShoppingListItem();
  const { showToast } = useToast();
  // Instant, revert-on-failure checked state, independent of the query cache's own timing (see
  // useToggleShoppingListItem's doc comment): flipped synchronously in the click handler itself,
  // so both the checkbox and which group the item is in update in the same tick as the tap.
  const [checkedOverride, setCheckedOverride] = useState<Record<number, boolean>>({});

  const items = list.items.map((item) => ({
    ...item,
    checked: checkedOverride[item.id] ?? item.checked,
  }));
  const uncheckedItems = items.filter((item) => !item.checked);
  const checkedItems = items.filter((item) => item.checked);

  function handleToggle(item: ShoppingListItem) {
    const nextChecked = !(checkedOverride[item.id] ?? item.checked);
    setCheckedOverride((current) => ({ ...current, [item.id]: nextChecked }));
    toggle.mutate(
      { id: item.id, checked: nextChecked },
      {
        onError: (mutationError) => {
          setCheckedOverride((current) => ({ ...current, [item.id]: !nextChecked }));
          showToast(apiErrorMessage(mutationError));
        },
      },
    );
  }

  function handleComplete() {
    if (!window.confirm('Fullføre handleturen?')) {
      return;
    }
    completeList.mutate(undefined, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <div className="flex flex-col">
      {uncheckedItems.length === 0 && checkedItems.length === 0 ? (
        <p className="p-4 text-gray-600">Handlelisten er tom.</p>
      ) : (
        <ul>
          {uncheckedItems.map((item) => (
            <ShoppingListItemRow key={item.id} item={item} onToggle={() => handleToggle(item)} />
          ))}
        </ul>
      )}

      {checkedItems.length > 0 && (
        <details className="px-4 py-2">
          <summary className="cursor-pointer py-2 text-sm text-gray-600">
            {completedLabel(checkedItems.length)}
          </summary>
          <ul>
            {checkedItems.map((item) => (
              <ShoppingListItemRow key={item.id} item={item} onToggle={() => handleToggle(item)} />
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-col gap-4 p-4">
        <AddItemField listId={list.id} />
        <button
          type="button"
          onClick={handleComplete}
          disabled={completeList.isPending}
          className="min-h-11 rounded bg-green-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Ferdig handlet
        </button>
      </div>
    </div>
  );
}

export default function ShoppingListPage() {
  const { data: list, isPending, isError } = useCurrentShoppingList();

  if (isPending) {
    return <p className="p-4">Laster …</p>;
  }

  if (isError) {
    return <p className="p-4">Noe gikk galt</p>;
  }

  if (list === null) {
    return <SuggestionsPreview />;
  }

  return <OpenListView list={list} />;
}
