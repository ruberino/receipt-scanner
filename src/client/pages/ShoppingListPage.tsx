import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { ShoppingList, ShoppingListItem } from '../../shared/schemas.ts';
import { isoWeekKey, todayInOslo } from '../../shared/dates.ts';
import { SHOPPING_CATEGORY_ORDER } from '../../shared/categories.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { formatTimeInOslo } from '../lib/format.ts';
import { useDebouncedValue } from '../lib/useDebouncedValue.ts';
import {
  useCompleteShoppingList,
  useCreateShoppingList,
  useCreateShoppingListItem,
  useCurrentShoppingList,
  useDeleteShoppingList,
  useDeleteShoppingListItem,
  useLatestShoppingList,
  useProductSearch,
  useRefreshShoppingList,
  useReopenShoppingList,
  useSuggestions,
  useToggleShoppingListItem,
} from '../api/queries.ts';
import ProposalPanel from '../components/ProposalPanel.tsx';
import ShoppingListItemRow from '../components/ShoppingListItemRow.tsx';
import SuggestionCard from '../components/SuggestionCard.tsx';
import { useToast } from '../components/Toast.tsx';

const DEBOUNCE_MS = 200;
const REMOVE_UNDO_MS = 6000;

function completedTodayInOslo(completedAt: string | null): boolean {
  return completedAt !== null && todayInOslo(new Date(completedAt)) === todayInOslo();
}

/** `isoWeekKey` works for any date within a week, not only its Monday (T32). */
function isoWeekNumber(date: string): number {
  return Number(isoWeekKey(date).split('-W')[1]);
}

function SuggestionsPreview() {
  const { data: suggestions, isPending, isError } = useSuggestions();
  const { data: latestList } = useLatestShoppingList();
  const createList = useCreateShoppingList();
  // Only rendered/enabled through handleReopen, gated on completedToday below; the list id is
  // fixed once latestList loads, same as any other per-resource mutation hook in this file.
  const reopen = useReopenShoppingList(latestList?.id ?? -1);
  const { showToast } = useToast();

  function handleCreate() {
    createList.mutate(undefined, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  function handleReopen() {
    reopen.mutate(undefined, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  const completedToday =
    latestList != null &&
    latestList.status === 'done' &&
    completedTodayInOslo(latestList.completedAt);

  return (
    <div className="page">
      <div className="stack">
        <h1 className="page-title">Forslag til uke {isoWeekNumber(todayInOslo())}</h1>
        {completedToday && latestList.completedAt !== null && (
          <p className="text-ink-muted">
            <span>Handleturen ble fullført kl. {formatTimeInOslo(latestList.completedAt)}</span>
            <Link to={`/shopping-lists/${latestList.id}`} className="link sep">
              Se handleturen
            </Link>
          </p>
        )}
      </div>

      <div className="stack">
        <button
          type="button"
          onClick={handleCreate}
          disabled={createList.isPending}
          className="btn btn-primary"
        >
          Lag handleliste
        </button>
        {completedToday && (
          <button
            type="button"
            onClick={handleReopen}
            disabled={reopen.isPending}
            className="btn btn-secondary"
          >
            Gjenåpne listen
          </button>
        )}
      </div>

      {isPending && <p className="text-ink-muted">Laster …</p>}
      {isError && <p>Noe gikk galt</p>}
      {!isPending && !isError && suggestions.length === 0 && (
        <p className="text-ink-muted">Ingen forslag ennå.</p>
      )}
      {!isPending && !isError && suggestions.length > 0 && (
        <ul className="flex flex-col">
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
        className="field"
      />
      {isOpen && (
        <ul role="listbox" className="popover">
          {(results ?? []).map((product) => (
            <li key={product.id} role="option">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addItem(product.name, product.id)}
                className="option"
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
                className="option font-semibold text-accent"
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

function boughtLabel(count: number): string {
  return count === 1 ? 'Kjøpt (1)' : `Kjøpt (${count})`;
}

/** T34: the toast after "Oppdater forslag". */
function addedItemsLabel(count: number): string {
  if (count === 0) {
    return 'Ingen nye forslag';
  }
  return count === 1 ? '1 vare lagt til' : `${count} varer lagt til`;
}

type PendingRemoval = { item: ShoppingListItem; timeoutId: ReturnType<typeof setTimeout> };

function OpenListView({ list }: { list: ShoppingList }) {
  const completeList = useCompleteShoppingList(list.id);
  const reopen = useReopenShoppingList(list.id);
  const deleteList = useDeleteShoppingList(list.id);
  const refresh = useRefreshShoppingList(list.id);
  const toggle = useToggleShoppingListItem();
  const deleteItem = useDeleteShoppingListItem();
  const { showToast } = useToast();
  // Instant, revert-on-failure checked state, independent of the query cache's own timing (see
  // useToggleShoppingListItem's doc comment): flipped synchronously in the click handler itself,
  // so both the checkbox and which group the item is in update in the same tick as the tap.
  const [checkedOverride, setCheckedOverride] = useState<Record<number, boolean>>({});
  // Deferred removal (T31): tapping "Fjern" hides the row and offers "Angre" for 6s before the
  // DELETE is actually sent. Only one removal is pending at a time, so a ref (not state) holds it
  // — the timeout callback and the "second removal" and "unmount" flush paths all need the current
  // value synchronously, not a stale render's closure.
  const pendingRemovalRef = useRef<PendingRemoval | null>(null);
  const [removedItemId, setRemovedItemId] = useState<number | null>(null);

  const items = list.items
    .filter((item) => item.id !== removedItemId)
    .map((item) => ({
      ...item,
      checked: checkedOverride[item.id] ?? item.checked,
    }));
  const uncheckedItems = items.filter((item) => !item.checked);
  const checkedItems = items.filter((item) => item.checked);

  // Grouped in store-walk order (T32); a group with no items in it is not rendered. `position` is
  // kept on the item but no longer drives the on-screen order.
  const groupedUncheckedItems = SHOPPING_CATEGORY_ORDER.map((category) => ({
    category,
    items: uncheckedItems
      .filter((item) => (item.category ?? 'Annet') === category)
      .sort((a, b) => a.name.localeCompare(b.name, 'nb')),
  })).filter((group) => group.items.length > 0);

  function sendPendingRemoval() {
    const pending = pendingRemovalRef.current;
    if (pending === null) {
      return;
    }
    clearTimeout(pending.timeoutId);
    pendingRemovalRef.current = null;
    deleteItem.mutate(pending.item.id, {
      onError: (mutationError) => {
        setRemovedItemId((current) => (current === pending.item.id ? null : current));
        showToast(apiErrorMessage(mutationError));
      },
    });
  }

  // Flush whatever is pending when this view goes away (T31), and only then: the closure is fixed
  // at mount, but it reads pendingRemovalRef.current at call time, which is always current, and
  // calls deleteItem.mutate/showToast from that same render, functionally equivalent to any other
  // render's since both close over the same stable queryClient and toast context.
  useEffect(() => {
    return () => {
      sendPendingRemoval();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush-on-unmount only, see comment above
  }, []);

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

  function handleRemove(item: ShoppingListItem) {
    sendPendingRemoval(); // only one removal pending at a time
    const timeoutId = setTimeout(sendPendingRemoval, REMOVE_UNDO_MS);
    pendingRemovalRef.current = { item, timeoutId };
    setRemovedItemId(item.id);
    showToast(`«${item.name}» fjernet`, {
      actionLabel: 'Angre',
      onAction: () => {
        if (pendingRemovalRef.current?.item.id === item.id) {
          clearTimeout(pendingRemovalRef.current.timeoutId);
          pendingRemovalRef.current = null;
          setRemovedItemId(null);
        }
      },
    });
  }

  function handleComplete() {
    // A pending removal must not outlive the list it belongs to (T31 review F1): flushed here,
    // while the list is still open, instead of possibly racing the completion via the unmount
    // flush and hitting a 409 on a now-done list, which would replace this toast with the error.
    sendPendingRemoval();
    completeList.mutate(undefined, {
      onSuccess: () => {
        showToast('Handleturen er fullført', {
          actionLabel: 'Angre',
          onAction: () => {
            reopen.mutate(undefined, {
              onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
            });
          },
        });
      },
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  function handleDeleteList() {
    if (!window.confirm('Slette handlelisten? Dette kan ikke angres.')) {
      return;
    }
    // The list's own delete cascades its items, so a pending removal is cancelled, not flushed
    // (T31 review F1): sending it separately would race a list that is about to stop existing.
    if (pendingRemovalRef.current !== null) {
      clearTimeout(pendingRemovalRef.current.timeoutId);
      pendingRemovalRef.current = null;
    }
    deleteList.mutate(undefined, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  function handleRefresh() {
    const previousItemIds = new Set(list.items.map((item) => item.id));
    refresh.mutate(undefined, {
      onSuccess: (updated) => {
        const addedCount = updated.items.filter((item) => !previousItemIds.has(item.id)).length;
        showToast(addedItemsLabel(addedCount));
      },
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <div className="page">
      <div className="stack">
        <h1 className="page-title">Handleliste uke {isoWeekNumber(list.weekStart)}</h1>
        <p className="text-ink-muted">
          {checkedItems.length} av {items.length} kjøpt
        </p>
      </div>

      {uncheckedItems.length === 0 && checkedItems.length === 0 ? (
        <p className="text-ink-muted">Handlelisten er tom.</p>
      ) : (
        groupedUncheckedItems.map(({ category, items: categoryItems }) => (
          <div key={category} className="stack gap-0">
            <h2 className="eyebrow">{category}</h2>
            <ul>
              {categoryItems.map((item) => (
                <ShoppingListItemRow
                  key={item.id}
                  item={item}
                  onToggle={() => handleToggle(item)}
                  onRemove={() => handleRemove(item)}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      {checkedItems.length > 0 && (
        <div className="stack gap-0">
          <p className="eyebrow">{boughtLabel(checkedItems.length)}</p>
          <ul>
            {checkedItems.map((item) => (
              <ShoppingListItemRow
                key={item.id}
                item={item}
                onToggle={() => handleToggle(item)}
                onRemove={() => handleRemove(item)}
              />
            ))}
          </ul>
        </div>
      )}

      <AddItemField listId={list.id} />

      <div className="stack">
        <ProposalPanel listId={list.id} />
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refresh.isPending}
          className="btn btn-secondary"
        >
          Oppdater forslag
        </button>
        <button
          type="button"
          onClick={handleComplete}
          disabled={completeList.isPending}
          className="btn btn-primary"
        >
          Ferdig handlet
        </button>
        <button
          type="button"
          onClick={handleDeleteList}
          disabled={deleteList.isPending}
          className="btn btn-danger"
        >
          Slett listen
        </button>
      </div>
    </div>
  );
}

export default function ShoppingListPage() {
  const { data: list, isPending, isError } = useCurrentShoppingList();

  if (isPending) {
    return <p className="page text-ink-muted">Laster …</p>;
  }

  if (isError) {
    return <p className="page">Noe gikk galt</p>;
  }

  return list === null ? <SuggestionsPreview /> : <OpenListView list={list} />;
}
