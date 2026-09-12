import { useEffect, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ReceiptDetail } from '../../shared/schemas.ts';
import { parseNok } from '../../shared/money.ts';
import { isoWeekKey, todayInOslo } from '../../shared/dates.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { formatShortDate } from '../lib/format.ts';
import {
  useDeleteReceipt,
  useInvalidateShoppingListsOnDone,
  useReceipt,
  useRecentDoneShoppingLists,
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
    <div className="page items-center">
      <img src={imageUrl} alt="Kvittering" className="max-h-96 rounded-md" />
      <div
        role="status"
        aria-label="Laster"
        className="h-8 w-8 animate-spin rounded-full border-4 border-ink/15 border-t-accent"
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
      className="btn btn-danger"
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
    <div className="page">
      <img src={receipt.imageUrl} alt="Kvittering" className="max-h-96 rounded-md" />
      <button
        type="button"
        onClick={handleScan}
        disabled={scan.isPending}
        className="btn btn-primary"
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
  const chipClassName = 'block';

  if (code === 'POSSIBLE_DUPLICATE' && receipt.possibleDuplicateOf !== null) {
    return (
      <Link
        to={`/receipts/${receipt.possibleDuplicateOf}`}
        className={`${chipClassName} underline underline-offset-2`}
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
 *
 * `Skjul bilde` lives inside the sticky panel itself (overlaid top-right), not beside `Vis
 * bilde`: once the panel is pinned and the user has scrolled into the lines, a hide control left
 * behind at the top would have scrolled out of reach with the header (T35 review F1). The panel
 * is a fixed-height outer box (sticky, `overflow-hidden`) with its own inner `overflow-auto`
 * scroller for the image, so the button stays put even while the image scrolls inside it.
 */
function ReceiptImageToggle({ imageUrl }: { imageUrl: string }) {
  const [visible, setVisible] = useState(readImagePanelPreference);

  function toggle() {
    const next = !visible;
    setVisible(next);
    writeImagePanelPreference(next);
  }

  if (!visible) {
    return (
      <div className="md:hidden">
        <button type="button" onClick={toggle} className="btn btn-secondary self-start">
          Vis bilde
        </button>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-10 -mx-5 h-[45vh] overflow-hidden bg-ink/5 md:hidden">
      <div className="h-full overflow-auto">
        <ReceiptImageLink imageUrl={imageUrl} />
      </div>
      <button
        type="button"
        onClick={toggle}
        className="btn btn-secondary absolute top-2 right-2 bg-field px-3 shadow"
      >
        Skjul bilde
      </button>
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
    <div className="stack">
      <label htmlFor="store-name" className="label">
        Butikk
      </label>
      <input
        id="store-name"
        type="text"
        value={storeName}
        onChange={(event) => setStoreName(event.target.value)}
        className="field"
      />

      <label htmlFor="purchased-at" className="label">
        Dato
      </label>
      <input
        id="purchased-at"
        type="date"
        value={purchasedAt}
        onChange={(event) => setPurchasedAt(event.target.value)}
        className="field"
      />

      <label htmlFor="total-kroner" className="label">
        Totalsum (kr)
      </label>
      <input
        id="total-kroner"
        type="text"
        inputMode="decimal"
        value={totalText}
        onChange={(event) => setTotalText(event.target.value)}
        className="field"
      />
      {totalError !== null && (
        <p role="alert" className="text-danger">
          {totalError}
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={updateReceipt.isPending}
        className="btn btn-primary"
      >
        Lagre
      </button>
      {error !== null && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {receipt.warnings.length > 0 && (
        <div className="note stack gap-1">
          {receipt.warnings.map((code) => (
            <WarningChip key={code} code={code} receipt={receipt} />
          ))}
        </div>
      )}
    </div>
  );
}

function weekNumber(date: string): number {
  return Number(isoWeekKey(date).split('-W')[1]);
}

function shoppingListOptionLabel(list: { weekStart: string; completedAt: string | null }): string {
  const week = weekNumber(list.weekStart);
  if (list.completedAt === null) {
    return `Uke ${week}`;
  }
  return `Uke ${week}, fullført ${formatShortDate(todayInOslo(new Date(list.completedAt)))}`;
}

/** `Ingen` plus the eight most recent completed lists; saving goes through the existing receipt
 * `PATCH` (T39). Linking is automatic on most receipts (`Knyttes automatisk …`), so this select is
 * mainly for the exceptions: a receipt bought a couple of days off, or two shops on one trip. */
function ShoppingListSelector({ receipt }: { receipt: ReceiptDetail }) {
  const { data: lists } = useRecentDoneShoppingLists();
  const updateReceipt = useUpdateReceipt(receipt.id);
  const { showToast } = useToast();

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const shoppingListId = event.target.value === '' ? null : Number(event.target.value);
    updateReceipt.mutate(
      { shoppingListId },
      { onError: (mutationError) => showToast(apiErrorMessage(mutationError)) },
    );
  }

  return (
    <div className="stack">
      <label htmlFor="shopping-list" className="label">
        Handleliste
      </label>
      {receipt.shoppingList !== null && (
        <Link to={`/shopping-lists/${receipt.shoppingList.id}`} className="link">
          Handleliste uke {weekNumber(receipt.shoppingList.weekStart)}
        </Link>
      )}
      <select
        id="shopping-list"
        value={receipt.shoppingListId ?? ''}
        onChange={handleChange}
        disabled={updateReceipt.isPending}
        className="field"
      >
        <option value="">Ingen</option>
        {(lists ?? []).map((list) => (
          <option key={list.id} value={list.id}>
            {shoppingListOptionLabel(list)}
          </option>
        ))}
      </select>
      <p className="meta">Knyttes automatisk når datoene stemmer</p>
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
    <div className="stack">
      {hasUnmatchedLines && (
        <button
          type="button"
          onClick={handleRematch}
          disabled={rematch.isPending}
          className="btn btn-secondary"
        >
          Prøv matching igjen
        </button>
      )}
      <button
        type="button"
        onClick={handleFinish}
        disabled={updateReceipt.isPending}
        className="btn btn-primary"
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
  useInvalidateShoppingListsOnDone(data?.status);

  if (isPending) {
    return <p className="page text-ink-muted">Laster …</p>;
  }

  if (isError || !data) {
    return <p className="page">Fant ikke kvitteringen.</p>;
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
      <div className="page">
        <img src={data.imageUrl} alt="Kvittering" className="max-h-96 rounded-md" />
        <ReceiptStatusBadge status={data.status} />
        <p role="alert" className="text-danger">
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
          className="btn btn-primary"
        >
          Prøv igjen
        </button>
        <DeleteReceiptButton receiptId={id} />
      </div>
    );
  }

  return (
    <div className="page md:max-w-5xl md:flex-row md:items-start">
      <div className="hidden md:sticky md:top-0 md:block md:max-h-[calc(100vh-4rem)] md:w-1/2 md:overflow-auto">
        <ReceiptImageLink imageUrl={data.imageUrl} />
      </div>
      <div className="flex flex-col gap-8 md:w-1/2">
        <ReceiptHeader key={data.id} receipt={data} />
        <ShoppingListSelector receipt={data} />
        <ReceiptImageToggle imageUrl={data.imageUrl} />
        <div className="flex flex-col">
          {data.lines.map((line) => (
            <ReceiptLineRow key={line.id} line={line} receiptId={data.id} />
          ))}
        </div>
        <ReceiptActions receipt={data} />
      </div>
    </div>
  );
}
