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
 * Tapping the item's text opens inline editing of its name and quantity (T32), replacing the
 * earlier tap-to-toggle behaviour on the text; the checkbox keeps its own 44 px tap target.
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
      <li className="flex flex-col gap-2 border-b border-gray-200 px-4 py-3">
        <label htmlFor={`shopping-item-name-${item.id}`} className="text-xs font-medium">
          Navn
        </label>
        <input
          id={`shopping-item-name-${item.id}`}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-h-11 rounded border border-gray-400 px-3 py-2"
        />
        {nameError !== null && (
          <p role="alert" className="text-red-600">
            {nameError}
          </p>
        )}

        <label htmlFor={`shopping-item-quantity-${item.id}`} className="text-xs font-medium">
          Antall
        </label>
        <input
          id={`shopping-item-quantity-${item.id}`}
          type="text"
          value={quantityText}
          onChange={(event) => setQuantityText(event.target.value)}
          className="min-h-11 rounded border border-gray-400 px-3 py-2"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={updateItem.isPending}
            className="min-h-11 flex-1 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Lagre
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="min-h-11 rounded border border-gray-400 px-4 py-2 font-medium"
          >
            Avbryt
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1 border-b border-gray-200 py-1">
      <label className="flex h-11 w-11 flex-shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={onToggle}
          aria-label={`Merk ${item.name} som kjøpt`}
          className="h-5 w-5"
        />
      </label>
      <button type="button" onClick={openEdit} className="min-h-11 min-w-0 flex-1 py-1 text-left">
        <p className={`truncate ${item.checked ? 'text-gray-400 line-through' : ''}`}>
          {item.name}
        </p>
        {item.quantityText !== null && <p className="text-sm text-gray-500">{item.quantityText}</p>}
        {item.reason !== null && <p className="text-xs text-gray-500">{item.reason}</p>}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Fjern ${item.name}`}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center text-lg text-gray-400"
      >
        ×
      </button>
    </li>
  );
}
