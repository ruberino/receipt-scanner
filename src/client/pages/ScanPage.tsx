import { useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiRequestError } from '../api/client.ts';
import { useReceipts, useScanReceipt, useUploadReceipt } from '../api/queries.ts';
import { useToast } from '../components/Toast.tsx';
import { downscaleImage } from '../lib/downscaleImage.ts';

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

type FileState =
  | { kind: 'preparing' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'uploaded' }
  | { kind: 'duplicate'; existingReceiptId: number | undefined }
  | { kind: 'failed'; message: string };

type FileEntry = {
  id: string;
  name: string;
  state: FileState;
};

function existingReceiptId(details: unknown): number | undefined {
  if (typeof details === 'object' && details !== null && 'existingReceiptId' in details) {
    const value = (details as { existingReceiptId: unknown }).existingReceiptId;
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

function fileStateLabel(state: FileState): string {
  switch (state.kind) {
    case 'preparing':
      return 'Forbereder …';
    case 'uploading':
      return `Laster opp … ${Math.round(state.progress * 100)} %`;
    case 'uploaded':
      return 'Lastet opp';
    case 'duplicate':
      return 'Allerede skannet';
    case 'failed':
      return `Feilet: ${state.message}`;
  }
}

export default function ScanPage() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const queueRef = useRef<{ id: string; file: File }[]>([]);
  const isProcessingRef = useRef(false);
  const nextIdRef = useRef(0);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const upload = useUploadReceipt();
  const scan = useScanReceipt();
  const { data: allReceipts } = useReceipts();

  const uploadedReceipts = (allReceipts ?? []).filter((receipt) => receipt.status === 'uploaded');

  function updateEntryState(id: string, state: FileState) {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, state } : entry)),
    );
  }

  async function processNext() {
    if (isProcessingRef.current) {
      return;
    }
    const next = queueRef.current.shift();
    if (!next) {
      return;
    }

    isProcessingRef.current = true;
    updateEntryState(next.id, { kind: 'preparing' });
    try {
      const downscaled = await downscaleImage(next.file, {
        maxEdge: MAX_EDGE,
        quality: JPEG_QUALITY,
      });
      updateEntryState(next.id, { kind: 'uploading', progress: 0 });
      await upload.mutateAsync({
        file: downscaled,
        onProgress: (fraction) =>
          updateEntryState(next.id, { kind: 'uploading', progress: fraction }),
      });
      updateEntryState(next.id, { kind: 'uploaded' });
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 409) {
        updateEntryState(next.id, {
          kind: 'duplicate',
          existingReceiptId: existingReceiptId(caught.details),
        });
      } else {
        updateEntryState(next.id, {
          kind: 'failed',
          message: caught instanceof ApiRequestError ? caught.message : 'Noe gikk galt',
        });
      }
    } finally {
      isProcessingRef.current = false;
      void processNext();
    }
  }

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    const items = files.map((file) => ({ id: `file-${nextIdRef.current++}`, file }));
    setEntries((current) => [
      ...current,
      ...items.map(({ id, file }) => ({
        id,
        name: file.name,
        state: { kind: 'preparing' as const },
      })),
    ]);
    queueRef.current.push(...items);
    void processNext();
  }

  async function handleScanAll() {
    const targets = uploadedReceipts.map((receipt) => receipt.id);
    for (const id of targets) {
      try {
        await scan.mutateAsync(id);
      } catch (caught) {
        showToast(caught instanceof ApiRequestError ? caught.message : 'Noe gikk galt');
      }
    }

    if (targets.length === 1) {
      navigate(`/receipts/${targets[0]}`);
    } else if (targets.length > 1) {
      navigate('/receipts');
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="camera-input"
        onChange={handleFilesSelected}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="library-input"
        onChange={handleFilesSelected}
      />

      <button
        type="button"
        onClick={() => cameraInputRef.current?.click()}
        className="min-h-11 rounded bg-blue-600 px-4 py-3 text-lg font-medium text-white"
      >
        Ta bilde
      </button>
      <button
        type="button"
        onClick={() => libraryInputRef.current?.click()}
        className="min-h-11 rounded border border-gray-400 px-4 py-2 font-medium"
      >
        Velg fra bilder
      </button>

      {entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2"
            >
              <span className="truncate text-sm">{entry.name}</span>
              {entry.state.kind === 'duplicate' && entry.state.existingReceiptId !== undefined ? (
                <Link
                  to={`/receipts/${entry.state.existingReceiptId}`}
                  className="whitespace-nowrap text-sm text-blue-600 underline"
                >
                  {fileStateLabel(entry.state)}
                </Link>
              ) : (
                <span className="whitespace-nowrap text-sm text-gray-600">
                  {fileStateLabel(entry.state)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {uploadedReceipts.length > 0 && (
        <button
          type="button"
          onClick={() => void handleScanAll()}
          disabled={scan.isPending}
          className="min-h-11 rounded bg-green-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {uploadedReceipts.length === 1 ? 'Skann (1)' : `Skann alle (${uploadedReceipts.length})`}
        </button>
      )}
    </div>
  );
}
