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
    <section className="flex flex-col gap-6">
      <h2 className="font-semibold">Handleturen</h2>

      <div className="stack gap-0">
        <h3 className="eyebrow">Kjøpt som planlagt ({bought.length})</h3>
        <ul>
          {bought.map((row) => (
            <li key={row.itemId} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate">{row.name}</p>
                {row.quantityText !== null && <p className="meta">{row.quantityText}</p>}
              </div>
              <span className="chip flex-shrink-0">{SOURCE_LABELS[row.source]}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="stack gap-0">
        <h3 className="eyebrow">Ikke kjøpt ({notBought.length})</h3>
        <ul>
          {notBought.map((row) => (
            <li key={row.itemId} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate">{row.name}</p>
                <div className="meta flex gap-2">
                  {row.quantityText !== null && <span>{row.quantityText}</span>}
                  {row.checked && <span>Avkrysset</span>}
                </div>
              </div>
              <span className="chip flex-shrink-0">{SOURCE_LABELS[row.source]}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="stack gap-0">
        <h3 className="eyebrow">Utenom lista ({trip.unplanned.length})</h3>
        <ul>
          {trip.unplanned.map((row) => (
            <li
              key={row.productId ?? row.name}
              className="flex items-center justify-between gap-3 py-2"
            >
              {row.productId !== null ? (
                <Link to={`/products/${row.productId}`} className="link min-w-0 truncate">
                  {row.name}
                </Link>
              ) : (
                <p className="min-w-0 truncate">{row.name}</p>
              )}
              <span className="flex-shrink-0 meta">{formatQuantity(row.quantity, row.unit)}</span>
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
    return <p className="page text-ink-muted">Laster …</p>;
  }

  if (isError || !data) {
    return <p className="page">Fant ikke handlelisten.</p>;
  }

  // The editable list lives at "/"; this page is the read-only look-back at a completed one.
  if (data.status === 'open') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="page">
      <div className="stack">
        <h1 className="page-title">Handleliste uke {isoWeekNumber(data.weekStart)}</h1>
        {data.completedAt !== null && (
          <p className="text-ink-muted">
            Fullført {formatDateWithRelative(todayInOslo(new Date(data.completedAt)))}
          </p>
        )}
        {data.receipts.length > 0 && (
          <ul className="flex flex-col">
            {data.receipts.map((receipt) => (
              <li key={receipt.id}>
                <Link to={`/receipts/${receipt.id}`} className="link">
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
        <p className="text-ink-muted">
          <span>Ingen kvittering er knyttet til denne listen ennå.</span> Knytt en kvittering til
          listen fra kvitteringssiden.
        </p>
      )}
    </div>
  );
}
