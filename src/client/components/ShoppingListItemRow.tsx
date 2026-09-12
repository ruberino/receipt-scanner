import { useState } from 'react';
import type { ShoppingListItem } from '../../shared/schemas.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { useUpdateShoppingListItem } from '../api/queries.ts';
import { useToast } from './Toast.tsx';

type ShoppingListItemRowProps = {
  item: ShoppingListItem;
  onToggle: () => void;
  onRemove: () => void;
};

/** Removal itself is deferred by `OpenListView` (T31): tapping the `×` here only tells the parent,
 * which hides the row, offers `Angre`, and sends the delete once the undo window passes.
 * The whole row (checkbox and text) toggles checked, as it did before T32 (T18 F1): checking off
 * is done many times per trip, one-handed, and deserves the row as its target. A dedicated pencil
 * button opens inline editing of the name and quantity instead (T32 review F1) — editing is rare.
 */
export default function ShoppingListItemRow({
  item,
  onToggle,
  onRemove,
}: ShoppingListItemRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [quantityText, setQuantityText] = useState(item.quantityText ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const updateItem = useUpdateShoppingListItem();
  const { showToast } = useToast();

  function openEdit() {
    setName(item.name);
    setQuantityText(item.quantityText ?? '');
    setNameError(null);
    setIsEditing(true);
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setNameError('Navnet kan ikke være tomt');
      return;
    }
    setNameError(null);

    const nextQuantityText = quantityText.trim() === '' ? null : quantityText.trim();
    const body: { name?: string; quantityText?: string | null } = {};
    if (trimmedName !== item.name) {
      body.name = trimmedName;
    }
    if (nextQuantityText !== item.quantityText) {
      body.quantityText = nextQuantityText;
    }
    if (Object.keys(body).length === 0) {
      setIsEditing(false);
      return;
    }

    updateItem.mutate(
      { id: item.id, ...body },
      {
        onSuccess: () => {
          showToast('Varen er oppdatert');
          setIsEditing(false);
        },
        onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
      },
    );
  }

  if (isEditing) {
    return (
      <li className="stack py-2">
        <label htmlFor={`shopping-item-name-${item.id}`} className="label">
          Navn
        </label>
        <input
          id={`shopping-item-name-${item.id}`}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="field"
        />
        {nameError !== null && (
          <p role="alert" className="text-danger">
            {nameError}
          </p>
        )}

        <label htmlFor={`shopping-item-quantity-${item.id}`} className="label">
          Antall
        </label>
        <input
          id={`shopping-item-quantity-${item.id}`}
          type="text"
          value={quantityText}
          onChange={(event) => setQuantityText(event.target.value)}
          className="field"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={updateItem.isPending}
            className="btn btn-primary flex-1"
          >
            Lagre
          </button>
          <button type="button" onClick={() => setIsEditing(false)} className="btn btn-secondary">
            Avbryt
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center">
      <label className="flex min-h-12 flex-1 items-center gap-3 py-1">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={onToggle}
          aria-label={`Merk ${item.name} som kjøpt`}
          className="h-5 w-5 flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div
            className={`flex items-baseline ${item.checked ? 'text-ink-muted line-through' : ''}`}
          >
            <p className="truncate">{item.name}</p>
            {item.quantityText !== null && (
              <span className="meta sep flex-shrink-0">{item.quantityText}</span>
            )}
          </div>
          {item.reason !== null && !item.checked && <p className="meta">{item.reason}</p>}
        </div>
      </label>
      <button
        type="button"
        onClick={openEdit}
        aria-label={`Rediger ${item.name}`}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center text-ink-muted"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Fjern ${item.name}`}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center text-ink-muted"
      >
        ×
      </button>
    </li>
  );
}
