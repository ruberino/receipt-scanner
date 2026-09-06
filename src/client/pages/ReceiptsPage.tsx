import { Link } from 'react-router';
import type { ReceiptSummary } from '../../shared/schemas.ts';
import { formatOre } from '../../shared/money.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { formatRelativeDate } from '../lib/format.ts';
import { useReceiptsList, useScanReceipt } from '../api/queries.ts';
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
