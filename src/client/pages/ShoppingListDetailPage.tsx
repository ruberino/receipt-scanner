import { Link, Navigate, useParams } from 'react-router';
import type { ShoppingList } from '../../shared/schemas.ts';
import { isoWeekKey, todayInOslo } from '../../shared/dates.ts';
import { formatOre } from '../../shared/money.ts';
import { formatDateWithRelative, formatQuantity, formatShortDate } from '../lib/format.ts';
import { useShoppingListDetail } from '../api/queries.ts';

/** `isoWeekKey` works for any date within a week, not only its Monday (T32). */
function isoWeekNumber(date: string): number {
  return Number(isoWeekKey(date).split('-W')[1]);
}

const SOURCE_LABELS: Record<'suggested' | 'manual' | 'ai', string> = {
  suggested: 'Forslag',
  manual: 'Manuell',
  ai: 'AI',
};

function receiptLinkLabel(receipt: ShoppingList['receipts'][number]): string {
  const store = receipt.storeName ?? 'Ukjent butikk';
  const date = receipt.purchasedAt !== null ? formatShortDate(receipt.purchasedAt) : 'ukjent dato';
  const total = receipt.totalOre !== null ? formatOre(receipt.totalOre) : '–';
  return `${store}, ${date}, ${total}`;
}

type Trip = NonNullable<ShoppingList['trip']>;

function TripSection({ trip }: { trip: Trip }) {
  const bought = trip.planned.filter((row) => row.status === 'bought');
  const notBought = trip.planned.filter((row) => row.status === 'notBought');

  return (
    <section className="flex flex-col gap-6 p-4">
      <h2 className="text-lg font-semibold">Handleturen</h2>

      <div>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Kjøpt som planlagt ({bought.length})
        </h3>
        <ul>
          {bought.map((row) => (
            <li
              key={row.itemId}
              className="flex items-center justify-between gap-2 border-b border-gray-200 py-2"
            >
              <div className="min-w-0">
                <p className="truncate">{row.name}</p>
                {row.quantityText !== null && (
                  <p className="text-sm text-gray-500">{row.quantityText}</p>
                )}
              </div>
              <span className="flex-shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {SOURCE_LABELS[row.source]}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Ikke kjøpt ({notBought.length})
        </h3>
        <ul>
          {notBought.map((row) => (
            <li
              key={row.itemId}
              className="flex items-center justify-between gap-2 border-b border-gray-200 py-2"
            >
              <div className="min-w-0">
                <p className="truncate">{row.name}</p>
                <div className="flex gap-2 text-sm text-gray-500">
                  {row.quantityText !== null && <span>{row.quantityText}</span>}
                  {row.checked && <span className="text-gray-400">Avkrysset</span>}
                </div>
              </div>
              <span className="flex-shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {SOURCE_LABELS[row.source]}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Utenom lista ({trip.unplanned.length})
        </h3>
        <ul>
          {trip.unplanned.map((row) => (
            <li
              key={row.productId ?? row.name}
              className="flex items-center justify-between gap-2 border-b border-gray-200 py-2"
            >
              {row.productId !== null ? (
                <Link
                  to={`/products/${row.productId}`}
                  className="min-w-0 truncate text-blue-600 underline"
                >
                  {row.name}
                </Link>
              ) : (
                <p className="min-w-0 truncate">{row.name}</p>
              )}
              <span className="flex-shrink-0 text-sm text-gray-500">
                {formatQuantity(row.quantity, row.unit)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function ShoppingListDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data, isPending, isError } = useShoppingListDetail(id);

  if (isPending) {
    return <p className="p-4">Laster …</p>;
  }

  if (isError || !data) {
    return <p className="p-4">Fant ikke handlelisten.</p>;
  }

  // The editable list lives at "/"; this page is the read-only look-back at a completed one.
  if (data.status === 'open') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <div className="flex flex-col gap-1 p-4">
        <h1 className="text-lg font-semibold">Handleliste uke {isoWeekNumber(data.weekStart)}</h1>
        {data.completedAt !== null && (
          <p className="text-sm text-gray-600">
            Fullført {formatDateWithRelative(todayInOslo(new Date(data.completedAt)))}
          </p>
        )}
        {data.receipts.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {data.receipts.map((receipt) => (
              <li key={receipt.id}>
                <Link to={`/receipts/${receipt.id}`} className="text-blue-600 underline">
                  {receiptLinkLabel(receipt)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.trip !== null ? (
        <TripSection trip={data.trip} />
      ) : (
        <div className="flex flex-col gap-1 p-4 text-gray-600">
          <p>Ingen kvittering er knyttet til denne listen ennå.</p>
          <p>Knytt en kvittering til listen fra kvitteringssiden.</p>
        </div>
      )}
    </div>
  );
}
