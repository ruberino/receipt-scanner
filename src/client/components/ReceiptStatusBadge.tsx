import type { ReceiptStatus } from '../../shared/schemas.ts';

const LABELS: Record<ReceiptStatus, string> = {
  uploaded: 'Lastet opp',
  pending: 'Venter',
  processing: 'Behandles',
  done: 'Ferdig',
  failed: 'Feilet',
};

// Plain small text, coloured only where the status asks for attention: `done` is the normal case
// on the receipts list and should be quiet, `processing` is live, `failed` needs a look.
const COLORS: Record<ReceiptStatus, string> = {
  uploaded: 'text-ink',
  pending: 'text-ink',
  processing: 'text-accent',
  done: 'text-ink-muted',
  failed: 'text-danger',
};

export default function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  return <span className={`chip ${COLORS[status]}`}>{LABELS[status]}</span>;
}
