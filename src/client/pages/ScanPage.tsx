import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiRequestError } from '../api/client.ts';
import { useReceipts, useScanReceipt, useUploadReceipt } from '../api/queries.ts';
import { useToast } from '../components/Toast.tsx';
import { downscaleImage } from '../lib/downscaleImage.ts';

const MAX_SHORT_EDGE = 1600;
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

/** A drag concerns this page only while it carries files; dragging selected text or a link must
 * leave it alone. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export default function ScanPage() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const dragDepthRef = useRef(0);
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
  const isQueueBusy = entries.some(
    (entry) => entry.state.kind === 'preparing' || entry.state.kind === 'uploading',
  );

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
        maxEdge: MAX_SHORT_EDGE,
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

  /** The one way a file enters the queue, whether it was chosen in the file picker or dropped on
   * the page. */
  function enqueueFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    const items = files.map((file) => ({ id: `file-${nextIdRef.current++}`, file }));
    setEntries((current) => [
      ...current,
      ...items.map(({ id, file }) => ({
        id,
        // A picked or dropped file always carries a name; a pasted screenshot arrives as
        // `image.png` in some browsers and as an empty string in others, and the row below renders
        // this straight (T44). The name is display only.
        name: file.name || 'Limt inn bilde',
        state: { kind: 'preparing' as const },
      })),
    ]);
    queueRef.current.push(...items);
    void processNext();
  }

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    enqueueFiles(files);
  }

  // The listeners below are registered once, so they must not close over the render that
  // registered them; this ref carries the current `enqueueFiles` to them.
  const enqueueFilesRef = useRef(enqueueFiles);
  useEffect(() => {
    enqueueFilesRef.current = enqueueFiles;
  });

  useEffect(() => {
    function onDragEnter(event: DragEvent) {
      if (!carriesFiles(event)) {
        return;
      }
      // `dragenter` and `dragleave` fire again for every element the pointer crosses, so the depth
      // counter, not the last event, decides when the drag has really left the window.
      dragDepthRef.current += 1;
      setIsDropTarget(true);
    }

    function onDragOver(event: DragEvent) {
      if (!carriesFiles(event)) {
        return;
      }
      // Without this the browser handles the drop itself and navigates away from the app to the
      // dropped file — the one failure in this feature that a jsdom test cannot see.
      event.preventDefault();
    }

    function onDragLeave(event: DragEvent) {
      if (!carriesFiles(event)) {
        return;
      }
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDropTarget(false);
      }
    }

    function onDrop(event: DragEvent) {
      if (!carriesFiles(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDropTarget(false);

      const files = Array.from(event.dataTransfer?.files ?? []);
      const images = files.filter((file) => file.type.startsWith('image/'));
      if (images.length < files.length) {
        showToast('Bare bilder kan lastes opp');
      }
      enqueueFilesRef.current(images);
    }

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [showToast]);

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      // No preventDefault: nothing on this page would otherwise receive the image, and a listener
      // that takes every paste is one that breaks the search fields if it ever outlives the page.
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) {
        return;
      }

      const images = files.filter((file) => file.type.startsWith('image/'));
      if (images.length < files.length) {
        showToast('Bare bilder kan lastes opp');
      }
      enqueueFilesRef.current(images);
    }

    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('paste', onPaste);
    };
  }, [showToast]);

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
    <div className="page">
      {/* Only in the DOM while a file is over the window: a full-screen element that is merely
          transparent would swallow taps on a phone, which has no drag-and-drop at all. */}
      {isDropTarget && (
        <div
          className="bg-paper/95 fixed inset-0 z-20 flex items-center justify-center"
          data-testid="drop-overlay"
        >
          <p className="page-title">Slipp bildene her</p>
        </div>
      )}

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

      <div className="stack">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="btn btn-primary"
        >
          Ta bilde
        </button>
        <button
          type="button"
          onClick={() => libraryInputRef.current?.click()}
          className="btn btn-secondary"
        >
          Velg fra bilder
        </button>
      </div>

      {entries.length > 0 && (
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <li key={entry.id} className="flex min-h-11 items-center justify-between gap-3">
              <span className="truncate">{entry.name}</span>
              {entry.state.kind === 'duplicate' && entry.state.existingReceiptId !== undefined ? (
                <Link
                  to={`/receipts/${entry.state.existingReceiptId}`}
                  className="whitespace-nowrap link"
                >
                  {fileStateLabel(entry.state)}
                </Link>
              ) : (
                <span className="whitespace-nowrap meta">{fileStateLabel(entry.state)}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {uploadedReceipts.length > 0 && (
        <button
          type="button"
          onClick={() => void handleScanAll()}
          disabled={scan.isPending || isQueueBusy}
          className="btn btn-primary"
        >
          {uploadedReceipts.length === 1 ? 'Skann (1)' : `Skann alle (${uploadedReceipts.length})`}
        </button>
      )}
    </div>
  );
}
