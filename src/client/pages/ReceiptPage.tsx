import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useReceipt, useRetryReceipt } from '../api/queries.ts';
import ReceiptStatusBadge from '../components/ReceiptStatusBadge.tsx';

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

  // The `done` state (editable header, warnings, lines, product picker) lands in T16.
  return <h1 className="p-4 text-xl font-bold">Kvittering</h1>;
}
