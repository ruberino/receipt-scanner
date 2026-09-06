import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiRequestError } from '../api/client.ts';
import { useUploadReceipt } from '../api/queries.ts';
import { useToast } from '../components/Toast.tsx';
import { downscaleImage } from '../lib/downscaleImage.ts';

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

function existingReceiptId(details: unknown): number | undefined {
  if (typeof details === 'object' && details !== null && 'existingReceiptId' in details) {
    const value = (details as { existingReceiptId: unknown }).existingReceiptId;
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

export default function ScanPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDownscaling, setIsDownscaling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const upload = useUploadReceipt();

  useEffect(() => {
    if (previewUrl === null) {
      return undefined;
    }
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) {
      return;
    }
    setFile(selected);
    setError(null);
    setProgress(0);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  async function handleUse() {
    if (!file) {
      return;
    }
    setError(null);
    setProgress(0);

    try {
      setIsDownscaling(true);
      const downscaled = await downscaleImage(file, { maxEdge: MAX_EDGE, quality: JPEG_QUALITY });
      setIsDownscaling(false);

      const result = await upload.mutateAsync({ file: downscaled, onProgress: setProgress });
      navigate(`/receipts/${result.id}`);
    } catch (caught) {
      setIsDownscaling(false);
      if (caught instanceof ApiRequestError && caught.status === 409) {
        showToast('Denne kvitteringen er allerede skannet');
        const id = existingReceiptId(caught.details);
        if (id !== undefined) {
          navigate(`/receipts/${id}`);
        }
        return;
      }
      setError(caught instanceof ApiRequestError ? caught.message : 'Noe gikk galt');
    }
  }

  const isBusy = isDownscaling || upload.isPending;

  return (
    <div className="flex flex-col gap-4 p-4">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="camera-input"
        onChange={handleFileSelected}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="library-input"
        onChange={handleFileSelected}
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

      {previewUrl !== null && (
        <div className="flex flex-col gap-2">
          <img src={previewUrl} alt="Forhåndsvisning av kvittering" className="max-h-96 rounded" />
          <button
            type="button"
            onClick={() => void handleUse()}
            disabled={isBusy}
            className="min-h-11 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Bruk
          </button>
          {isBusy && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="h-2 w-full rounded bg-gray-200"
            >
              <div
                className="h-2 rounded bg-blue-600"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {error !== null && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
