import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ReceiptDetail } from '../../shared/schemas.ts';
import { parseNok } from '../../shared/money.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import {
  useDeleteReceipt,
  useReceipt,
  useRematch,
  useScanReceipt,
  useUpdateReceipt,
} from '../api/queries.ts';
import ReceiptLineRow from '../components/ReceiptLineRow.tsx';
import ReceiptStatusBadge from '../components/ReceiptStatusBadge.tsx';
import { useToast } from '../components/Toast.tsx';

const PROCESSING_LABELS: Record<'pending' | 'processing', string> = {
  pending: 'I kø…',
  processing: 'Leser kvittering…',
};

/** Seconds since `updatedAt`, the server's own timestamp of the last status change, never below 0
 * (a small clock skew must not show a negative wait). Counting from this instead of mount time
 * (T30) means leaving and reopening the page shows the same elapsed time, not a restarted one. */
function elapsedSecondsSince(updatedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(updatedAt)) / 1000));
}

type ProcessingViewProps = {
  imageUrl: string;
  status: 'pending' | 'processing';
  updatedAt: string;
};

// Keyed on `updatedAt` at the call site, so a fresh timestamp (the pending -> processing
// transition) remounts this component instead of needing a synchronous resync inside an effect.
function ProcessingView({ imageUrl, status, updatedAt }: ProcessingViewProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => elapsedSecondsSince(updatedAt));

  useEffect(() => {
    const interval = setInterval(() => setElapsedSeconds(elapsedSecondsSince(updatedAt)), 1000);
    return () => clearInterval(interval);
  }, [updatedAt]);

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <img src={imageUrl} alt="Kvittering" className="max-h-96 rounded" />
      <div
        role="status"
        aria-label="Laster"
        className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600"
      />
      <p>
        {PROCESSING_LABELS[status]} ({elapsedSeconds} s)
      </p>
    </div>
  );
}

/**
 * Shared by every ReceiptPage state that can delete the receipt (uploaded, failed, done): one
 * handler and one button, so a receipt stuck in any status has the same way out (T30).
 */
function DeleteReceiptButton({ receiptId }: { receiptId: number }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const deleteReceipt = useDeleteReceipt(receiptId);

  function handleDelete() {
    if (!window.confirm('Slette denne kvitteringen? Dette kan ikke angres.')) {
      return;
    }
    deleteReceipt.mutate(undefined, {
      onSuccess: () => {
        showToast('Kvitteringen er slettet');
        navigate('/receipts');
      },
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleteReceipt.isPending}
      className="min-h-11 rounded border border-red-600 px-4 py-2 font-medium text-red-600 disabled:opacity-50"
    >
      Slett kvittering
    </button>
  );
}

function UploadedView({ receipt }: { receipt: ReceiptDetail }) {
  const { showToast } = useToast();
  const scan = useScanReceipt();

  function handleScan() {
    scan.mutate(receipt.id, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <img src={receipt.imageUrl} alt="Kvittering" className="max-h-96 rounded" />
      <button
        type="button"
        onClick={handleScan}
        disabled={scan.isPending}
        className="min-h-11 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        Skann
      </button>
      <DeleteReceiptButton receiptId={receipt.id} />
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

function formatKronerText(totalOre: number | null): string {
  return ((totalOre ?? 0) / 100).toFixed(2).replace('.', ',');
}

/** A tap opens the full image in a new tab, for pinch-zoom (T35). */
function ReceiptImageLink({ imageUrl, className }: { imageUrl: string; className?: string }) {
  return (
    <a href={imageUrl} target="_blank" rel="noreferrer" className={className}>
      <img src={imageUrl} alt="Kvitteringsbilde" className="w-full rounded" />
    </a>
  );
}

const IMAGE_PANEL_STORAGE_KEY = 'receipt-image-panel';

function readImagePanelPreference(): boolean {
  try {
    return sessionStorage.getItem(IMAGE_PANEL_STORAGE_KEY) === 'shown';
  } catch {
    return false;
  }
}

function writeImagePanelPreference(visible: boolean): void {
  try {
    sessionStorage.setItem(IMAGE_PANEL_STORAGE_KEY, visible ? 'shown' : 'hidden');
  } catch {
    // Private browsing or disabled storage: the toggle still works for this page view.
  }
}

/**
 * Phone-only toggle, directly under the header's warning chips (T35). The desktop two-column
 * layout shows the image unconditionally instead, so this whole block is `md:hidden`.
 */
function ReceiptImageToggle({ imageUrl }: { imageUrl: string }) {
  const [visible, setVisible] = useState(readImagePanelPreference);

  function toggle() {
    const next = !visible;
    setVisible(next);
    writeImagePanelPreference(next);
  }

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={toggle}
        className="mx-4 min-h-11 rounded border border-gray-400 px-4 py-2 font-medium"
      >
        {visible ? 'Skjul bilde' : 'Vis bilde'}
      </button>
      {visible && (
        <div className="sticky top-0 z-10 mt-2 h-[45vh] overflow-auto bg-gray-100">
          <ReceiptImageLink imageUrl={imageUrl} />
        </div>
      )}
    </div>
  );
}

function ReceiptHeader({ receipt }: { receipt: ReceiptDetail }) {
  const [storeName, setStoreName] = useState(receipt.storeName ?? '');
  const [purchasedAt, setPurchasedAt] = useState(receipt.purchasedAt ?? '');
  const [totalText, setTotalText] = useState(formatKronerText(receipt.totalOre));
  const [totalError, setTotalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateReceipt = useUpdateReceipt(receipt.id);
  const { showToast } = useToast();

  function handleSave() {
    setError(null);
    setTotalError(null);

    let totalOre: number;
    try {
      totalOre = parseNok(totalText);
    } catch {
      setTotalError('Ugyldig totalsum');
      return;
    }

    updateReceipt.mutate(
      {
        storeName: storeName.trim() === '' ? null : storeName.trim(),
        purchasedAt,
        totalOre,
      },
      {
        onSuccess: () => showToast('Lagret'),
        onError: (mutationError) => setError(apiErrorMessage(mutationError)),
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
        type="text"
        inputMode="decimal"
        value={totalText}
        onChange={(event) => setTotalText(event.target.value)}
        className="min-h-11 rounded border border-gray-400 px-3 py-2"
      />
      {totalError !== null && (
        <p role="alert" className="text-red-600">
          {totalError}
        </p>
      )}

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
  const { showToast } = useToast();
  const rematch = useRematch(receipt.id);
  const updateReceipt = useUpdateReceipt(receipt.id);

  const hasUnmatchedLines = receipt.warnings.some((code) => UNMATCHED_WARNINGS.has(code));

  function handleFinish() {
    updateReceipt.mutate(
      { reviewed: true },
      {
        onSuccess: () => showToast('Kvitteringen er ferdig gjennomgått'),
        onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
      },
    );
  }

  function handleRematch() {
    rematch.mutate(undefined, {
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {hasUnmatchedLines && (
        <button
          type="button"
          onClick={handleRematch}
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
      <DeleteReceiptButton receiptId={receipt.id} />
    </div>
  );
}

export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { data, isPending, isError } = useReceipt(id);
  const scan = useScanReceipt();
  const { showToast } = useToast();

  if (isPending) {
    return <p className="p-4">Laster …</p>;
  }

  if (isError || !data) {
    return <p className="p-4">Fant ikke kvitteringen.</p>;
  }

  if (data.status === 'uploaded') {
    return <UploadedView receipt={data} />;
  }

  if (data.status === 'pending' || data.status === 'processing') {
    return (
      <ProcessingView
        key={data.updatedAt}
        imageUrl={data.imageUrl}
        status={data.status}
        updatedAt={data.updatedAt}
      />
    );
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
          onClick={() =>
            scan.mutate(id, {
              onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
            })
          }
          disabled={scan.isPending}
          className="min-h-11 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Prøv igjen
        </button>
        <DeleteReceiptButton receiptId={id} />
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row md:items-start md:gap-4 md:p-4">
      <div className="hidden md:sticky md:top-0 md:block md:max-h-[calc(100vh-4rem)] md:w-1/2 md:overflow-auto">
        <ReceiptImageLink imageUrl={data.imageUrl} />
      </div>
      <div className="flex flex-col md:w-1/2">
        <ReceiptHeader key={data.id} receipt={data} />
        <ReceiptImageToggle imageUrl={data.imageUrl} />
        <div className="px-4">
          {data.lines.map((line) => (
            <ReceiptLineRow key={line.id} line={line} receiptId={data.id} />
          ))}
        </div>
        <ReceiptActions receipt={data} />
      </div>
    </div>
  );
}
