import type { ShoppingListItem } from '../../shared/schemas.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { useDeleteShoppingListItem } from '../api/queries.ts';
import { useToast } from './Toast.tsx';

type ShoppingListItemRowProps = {
  item: ShoppingListItem;
  onToggle: () => void;
};

export default function ShoppingListItemRow({ item, onToggle }: ShoppingListItemRowProps) {
  const deleteItem = useDeleteShoppingListItem();
  const { showToast } = useToast();

  function handleRemove() {
    deleteItem.mutate(item.id, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <li className="flex items-center gap-3 border-b border-gray-200 py-3">
      <input
        type="checkbox"
        checked={item.checked}
        onChange={onToggle}
        aria-label={`Merk ${item.name} som kjøpt`}
        className="h-5 w-5 flex-shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate ${item.checked ? 'text-gray-400 line-through' : ''}`}>
          {item.name}
        </p>
        {item.quantityText !== null && <p className="text-sm text-gray-500">{item.quantityText}</p>}
        {item.reason !== null && <p className="text-xs text-gray-500">{item.reason}</p>}
      </div>
      <button
        type="button"
        onClick={handleRemove}
        disabled={deleteItem.isPending}
        aria-label={`Fjern ${item.name}`}
        className="min-h-11 min-w-11 flex-shrink-0 text-sm text-red-600 disabled:opacity-50"
      >
        Fjern
      </button>
    </li>
  );
}
