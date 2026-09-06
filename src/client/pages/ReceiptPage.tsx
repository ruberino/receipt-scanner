import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ReceiptDetail } from '../../shared/schemas.ts';
import { ApiRequestError } from '../api/client.ts';
import {
  useDeleteReceipt,
  useReceipt,
  useRematch,
  useRetryReceipt,
  useUpdateReceipt,
} from '../api/queries.ts';
import ReceiptLineRow from '../components/ReceiptLineRow.tsx';
import ReceiptStatusBadge from '../components/ReceiptStatusBadge.tsx';
import { useToast } from '../components/Toast.tsx';

// A separate component so its elapsed-seconds counter resets naturally on mount, every time the
// receipt (re-)enters the processing state, instead of a manual reset inside an effect.
function ProcessingView({ imageUrl }: { imageUrl: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <img src={imageUrl} alt="Kvittering" className="max-h-96 rounded" />
      <div
        role="status"
        aria-label="Laster"
        className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"
      />
      <p>Leser kvittering… ({elapsedSeconds} s)</p>
    </div>
  );
}

const WARNING_LABELS: Record<string, (receipt: ReceiptDetail) => string> = {
  TOTAL_MISMATCH: () => 'Summen av linjene stemmer ikke med totalen',
  MISSING_STORE: () => 'Mangler butikknavn',
  MISSING_DATE: () => 'Mangler dato',
  FUTURE_DATE: () => 'Datoen er i fremtiden',
  UNMATCHED_LINES: () => 'Noen varer er ikke gjenkjent',
  MATCHING_FAILED: () => 'Automatisk varegjenkjenning feilet',
  POSSIBLE_DUPLICATE: (receipt) =>
    `Ligner på kvittering #${receipt.possibleDuplicateOf}, er den skannet to ganger?`,
};

function WarningChip({ code, receipt }: { code: string; receipt: ReceiptDetail }) {
  const label = WARNING_LABELS[code]?.(receipt) ?? code;
  const chipClassName = 'inline-block rounded-full bg-yellow-100 px-3 py-1 text-xs text-yellow-800';

  if (code === 'POSSIBLE_DUPLICATE' && receipt.possibleDuplicateOf !== null) {
    return (
      <Link
        to={`/receipts/${receipt.possibleDuplicateOf}`}
        className={`${chipClassName} underline`}
      >
        {label}
      </Link>
    );
  }

  return <span className={chipClassName}>{label}</span>;
}

function ReceiptHeader({ receipt }: { receipt: ReceiptDetail }) {
  const [storeName, setStoreName] = useState(receipt.storeName ?? '');
  const [purchasedAt, setPurchasedAt] = useState(receipt.purchasedAt ?? '');
  const [totalKroner, setTotalKroner] = useState(
    receipt.totalOre !== null ? receipt.totalOre / 100 : 0,
  );
  const [error, setError] = useState<string | null>(null);
  const updateReceipt = useUpdateReceipt(receipt.id);
  const { showToast } = useToast();

  function handleSave() {
    setError(null);
    updateReceipt.mutate(
      {
        storeName: storeName.trim() === '' ? null : storeName.trim(),
        purchasedAt,
        totalOre: Math.round(totalKroner * 100),
      },
      {
        onSuccess: () => showToast('Lagret'),
        onError: (mutationError) => {
          setError(
            mutationError instanceof ApiRequestError ? mutationError.message : 'Noe gikk galt',
          );
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <label htmlFor="store-name" className="text-sm font-medium">
        Butikk
      </label>
      <input
        id="store-name"
        type="text"
        value={storeName}
        onChange={(event) => setStoreName(event.target.value)}
        className="min-h-11 rounded border border-gray-400 px-3 py-2"
      />

      <label htmlFor="purchased-at" className="text-sm font-medium">
        Dato
      </label>
      <input
        id="purchased-at"
        type="date"
        value={purchasedAt}
        onChange={(event) => setPurchasedAt(event.target.value)}
        className="min-h-11 rounded border border-gray-400 px-3 py-2"
      />

      <label htmlFor="total-kroner" className="text-sm font-medium">
        Totalsum (kr)
      </label>
      <input
        id="total-kroner"
        type="number"
        step="0.01"
        min="0"
        value={totalKroner}
        onChange={(event) => setTotalKroner(Number(event.target.value))}
        className="min-h-11 rounded border border-gray-400 px-3 py-2"
      />

      <button
        type="button"
        onClick={handleSave}
        disabled={updateReceipt.isPending}
        className="min-h-11 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        Lagre
      </button>
      {error !== null && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}

      {receipt.warnings.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {receipt.warnings.map((code) => (
            <WarningChip key={code} code={code} receipt={receipt} />
          ))}
        </div>
      )}
    </div>
  );
}

const UNMATCHED_WARNINGS = new Set(['UNMATCHED_LINES', 'MATCHING_FAILED']);

function ReceiptActions({ receipt }: { receipt: ReceiptDetail }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const rematch = useRematch(receipt.id);
  const updateReceipt = useUpdateReceipt(receipt.id);
  const deleteReceipt = useDeleteReceipt(receipt.id);

  const hasUnmatchedLines = receipt.warnings.some((code) => UNMATCHED_WARNINGS.has(code));

  function handleFinish() {
    updateReceipt.mutate(
      { reviewed: true },
      { onSuccess: () => showToast('Kvitteringen er ferdig gjennomgått') },
    );
  }

  function handleDelete() {
    if (!window.confirm('Slette denne kvitteringen? Dette kan ikke angres.')) {
      return;
    }
    deleteReceipt.mutate(undefined, { onSuccess: () => navigate('/receipts') });
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {hasUnmatchedLines && (
        <button
          type="button"
          onClick={() => rematch.mutate()}
          disabled={rematch.isPending}
          className="min-h-11 rounded border border-blue-600 px-4 py-2 font-medium text-blue-600 disabled:opacity-50"
        >
          Prøv matching igjen
        </button>
      )}
      <button
        type="button"
        onClick={handleFinish}
        disabled={updateReceipt.isPending}
        className="min-h-11 rounded bg-green-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        Ferdig
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleteReceipt.isPending}
        className="min-h-11 rounded border border-red-600 px-4 py-2 font-medium text-red-600 disabled:opacity-50"
      >
        Slett kvittering
      </button>
    </div>
  );
}

export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data, isPending, isError } = useReceipt(id);
  const retry = useRetryReceipt(id);

  if (isPending) {
    return <p className="p-4">Laster …</p>;
  }

  if (isError || !data) {
    return <p className="p-4">Fant ikke kvitteringen.</p>;
  }

  if (data.status === 'pending' || data.status === 'processing') {
    return <ProcessingView imageUrl={data.imageUrl} />;
  }

  if (data.status === 'failed') {
    return (
      <div className="flex flex-col gap-4 p-6">
        <img src={data.imageUrl} alt="Kvittering" className="max-h-96 rounded" />
        <ReceiptStatusBadge status={data.status} />
        <p role="alert" className="text-red-600">
          {data.errorMessage ?? 'Noe gikk galt'}
        </p>
        <button
          type="button"
          onClick={() => retry.mutate()}
          disabled={retry.isPending}
          className="min-h-11 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Prøv igjen
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <ReceiptHeader receipt={data} />
      <div className="px-4">
        {data.lines.map((line) => (
          <ReceiptLineRow key={line.id} line={line} receiptId={data.id} />
        ))}
      </div>
      <ReceiptActions receipt={data} />
    </div>
  );
}
