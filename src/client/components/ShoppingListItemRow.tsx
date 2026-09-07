import type { ShoppingListItem } from '../../shared/schemas.ts';

type ShoppingListItemRowProps = {
  item: ShoppingListItem;
  onToggle: () => void;
  onRemove: () => void;
};

/** Removal itself is deferred by `OpenListView` (T31): tapping `Fjern` here only tells the parent,
 * which hides the row, offers `Angre`, and sends the delete once the undo window passes. */
export default function ShoppingListItemRow({
  item,
  onToggle,
  onRemove,
}: ShoppingListItemRowProps) {
  return (
    <li className="flex items-center gap-3 border-b border-gray-200 py-3">
      <label className="flex min-h-11 flex-1 items-center gap-3">
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
          {item.quantityText !== null && (
            <p className="text-sm text-gray-500">{item.quantityText}</p>
          )}
          {item.reason !== null && <p className="text-xs text-gray-500">{item.reason}</p>}
        </div>
      </label>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Fjern ${item.name}`}
        className="min-h-11 min-w-11 flex-shrink-0 text-sm text-red-600"
      >
        Fjern
      </button>
    </li>
  );
}
