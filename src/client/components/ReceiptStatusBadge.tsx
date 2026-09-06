import type { ReceiptStatus } from '../../shared/schemas.ts';

const LABELS: Record<ReceiptStatus, string> = {
  uploaded: 'Lastet opp',
  pending: 'Venter',
  processing: 'Behandles',
  done: 'Ferdig',
  failed: 'Feilet',
};

const COLORS: Record<ReceiptStatus, string> = {
  uploaded: 'bg-gray-200 text-gray-800',
  pending: 'bg-gray-200 text-gray-800',
  processing: 'bg-blue-200 text-blue-800',
  done: 'bg-green-200 text-green-800',
  failed: 'bg-red-200 text-red-800',
};

export default function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${COLORS[status]}`}>
      {LABELS[status]}
    </span>
  );
}
