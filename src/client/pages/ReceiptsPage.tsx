import { useState } from 'react';
import { Link } from 'react-router';
import type {
  MonthlyStats,
  Product,
  ReceiptSummary,
  ShoppingListSummary,
} from '../../shared/schemas.ts';
import { formatOre } from '../../shared/money.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { formatDate, formatMonth, formatRelativeDate } from '../lib/format.ts';
import {
  useReceiptsList,
  useScanReceipt,
  useShoppingListHistory,
  useStatsSummary,
} from '../api/queries.ts';
import ReceiptStatusBadge from '../components/ReceiptStatusBadge.tsx';
import { useToast } from '../components/Toast.tsx';

function warningCountLabel(count: number): string | null {
  if (count === 0) {
    return null;
  }
  return count === 1 ? '1 varsel' : `${count} varsler`;
}

function storeNameLabel(receipt: ReceiptSummary): string {
  if (receipt.storeName !== null) {
    return receipt.storeName;
  }
  if (receipt.status === 'uploaded') {
    return 'Ikke skannet ennå';
  }
  if (receipt.status === 'failed') {
    return 'Lesing feilet';
  }
  return 'Ukjent butikk';
}

function dateLabel(receipt: ReceiptSummary): string {
  if (receipt.purchasedAt !== null) {
    return formatRelativeDate(receipt.purchasedAt);
  }
  return `Lastet opp ${formatRelativeDate(receipt.createdAt.slice(0, 10))}`;
}

function shoppingListStatusLabel(status: ShoppingListSummary['status']): string {
  return status === 'open' ? 'Åpen' : 'Fullført';
}

function MonthlyBarsSection({ months }: { months: MonthlyStats[] }) {
  const maxOre = Math.max(0, ...months.map((month) => month.totalOre));

  return (
    <section>
      <h3 className="mb-2 font-medium">Per måned</h3>
      <ul className="flex flex-col gap-2">
        {months.map((month) => (
          <li key={month.month} className="flex items-center gap-3 text-sm">
            <span className="w-16 flex-shrink-0 text-gray-600">{formatMonth(month.month)}</span>
            <div className="h-3 flex-1 rounded bg-gray-100">
              <div
                className="h-3 rounded bg-blue-600"
                style={{ width: `${maxOre === 0 ? 0 : (month.totalOre / maxOre) * 100}%` }}
              />
            </div>
            <span className="w-20 flex-shrink-0 text-right">{formatOre(month.totalOre)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TopProductsSection({ products }: { products: Product[] }) {
  return (
    <section>
      <h3 className="mb-2 font-medium">Mest kjøpt, alle kvitteringer</h3>
      <ol className="flex flex-col gap-1">
        {products.map((product) => (
          <li key={product.id} className="flex justify-between gap-3 text-sm">
            <span className="truncate">{product.name}</span>
            <span className="flex-shrink-0 text-gray-600">{product.timesBought}×</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ShoppingListHistorySection({ lists }: { lists: ShoppingListSummary[] }) {
  return (
    <section>
      <h3 className="mb-2 font-medium">Handlelistehistorikk</h3>
      <ul className="flex flex-col gap-1">
        {lists.map((list) => (
          <li key={list.id} className="flex justify-between gap-3 text-sm">
            <span>Uke {formatDate(list.weekStart)}</span>
            <span className="flex-shrink-0 text-gray-600">
              {list.itemCount} {list.itemCount === 1 ? 'vare' : 'varer'}
            </span>
            <span className="flex-shrink-0">{shoppingListStatusLabel(list.status)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatsAndHistory() {
  const [isOpen, setIsOpen] = useState(false);
  const stats = useStatsSummary(isOpen);
  const history = useShoppingListHistory(isOpen);

  return (
    <details
      className="border-b border-gray-200 p-4"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">Statistikk og historikk</summary>
      {isOpen && (
        <div className="mt-4 flex flex-col gap-6">
          {stats.isPending && <p>Laster …</p>}
          {stats.isError && <p>Noe gikk galt</p>}
          {stats.isSuccess && (
            <>
              <MonthlyBarsSection months={stats.data.months} />
              <TopProductsSection products={stats.data.topProducts} />
            </>
          )}

          {history.isPending && <p>Laster …</p>}
          {history.isError && <p>Noe gikk galt</p>}
          {history.isSuccess && <ShoppingListHistorySection lists={history.data} />}
        </div>
      )}
    </details>
  );
}

function ReceiptRow({ receipt }: { receipt: ReceiptSummary }) {
  const { showToast } = useToast();
  const scan = useScanReceipt();
  const warningLabel = warningCountLabel(receipt.warnings.length);

  function handleScan() {
    scan.mutate(receipt.id, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 border-b border-gray-200 p-4">
      <Link to={`/receipts/${receipt.id}`} className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-medium">{storeNameLabel(receipt)}</span>
        <span className="text-sm text-gray-600">{dateLabel(receipt)}</span>
        {warningLabel !== null && <span className="text-xs text-yellow-800">{warningLabel}</span>}
      </Link>
      <div className="flex flex-shrink-0 items-center gap-2">
        <span className="whitespace-nowrap">
          {receipt.totalOre !== null ? formatOre(receipt.totalOre) : '–'}
        </span>
        <ReceiptStatusBadge status={receipt.status} />
        {receipt.status === 'uploaded' && (
          <button
            type="button"
            onClick={handleScan}
            disabled={scan.isPending}
            className="min-h-11 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Skann
          </button>
        )}
      </div>
    </li>
  );
}

export default function ReceiptsPage() {
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useReceiptsList();
  const scanAll = useScanReceipt();
  const { showToast } = useToast();

  const receipts = data?.pages.flat() ?? [];
  const uploadedIds = receipts
    .filter((receipt) => receipt.status === 'uploaded')
    .map((receipt) => receipt.id);

  async function handleScanAll() {
    for (const id of uploadedIds) {
      try {
        await scanAll.mutateAsync(id);
      } catch (caught) {
        showToast(apiErrorMessage(caught));
      }
    }
  }

  if (isPending) {
    return <p className="p-4">Laster …</p>;
  }

  if (isError) {
    return <p className="p-4">Noe gikk galt</p>;
  }

  return (
    <div className="flex flex-col">
      {uploadedIds.length > 0 && (
        <div className="p-4">
          <button
            type="button"
            onClick={() => void handleScanAll()}
            disabled={scanAll.isPending}
            className="min-h-11 w-full rounded bg-green-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {uploadedIds.length === 1 ? 'Skann (1)' : `Skann alle (${uploadedIds.length})`}
          </button>
        </div>
      )}

      <StatsAndHistory />

      {receipts.length === 0 ? (
        <p className="p-4">Ingen kvitteringer ennå.</p>
      ) : (
        <ul>
          {receipts.map((receipt) => (
            <ReceiptRow key={receipt.id} receipt={receipt} />
          ))}
        </ul>
      )}

      {hasNextPage && (
        <div className="p-4">
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="min-h-11 w-full rounded border border-gray-400 px-4 py-2 font-medium disabled:opacity-50"
          >
            Last flere
          </button>
        </div>
      )}
    </div>
  );
}
