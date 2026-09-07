import { useState } from 'react';
import type { LineKind, ReceiptLine } from '../../shared/schemas.ts';
import { parseNok } from '../../shared/money.ts';
import { apiErrorMessage } from '../lib/errorMessage.ts';
import { formatOre, formatQuantity } from '../lib/format.ts';
import { useDeleteReceiptLine, useUpdateReceiptLineFields } from '../api/queries.ts';
import ProductPicker from './ProductPicker.tsx';
import { useToast } from './Toast.tsx';

const NON_ITEM_LABELS: Record<Exclude<ReceiptLine['kind'], 'item'>, string> = {
  discount: 'Rabatt',
  deposit: 'Pant',
  other: 'Annet',
};

const KIND_OPTIONS: { value: LineKind; label: string }[] = [
  { value: 'item', label: 'Vare' },
  { value: 'discount', label: 'Rabatt' },
  { value: 'deposit', label: 'Pant' },
  { value: 'other', label: 'Annet' },
];

/** `totalOre` as a kroner text field's starting value, e.g. `-1000` -> `"-10,00"`. */
function krText(totalOre: number): string {
  return (totalOre / 100).toFixed(2).replace('.', ',');
}

type ReceiptLineRowProps = {
  line: ReceiptLine;
  receiptId: number;
};

export default function ReceiptLineRow({ line, receiptId }: ReceiptLineRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [amountText, setAmountText] = useState(() => krText(line.totalOre));
  const [kind, setKind] = useState<LineKind>(line.kind);
  const [amountError, setAmountError] = useState<string | null>(null);
  const updateFields = useUpdateReceiptLineFields(receiptId);
  const deleteLine = useDeleteReceiptLine(receiptId);
  const { showToast } = useToast();

  const isItem = line.kind === 'item';

  function openEdit() {
    setAmountText(krText(line.totalOre));
    setKind(line.kind);
    setAmountError(null);
    setIsEditing(true);
  }

  function handleSave() {
    setAmountError(null);

    let totalOre: number;
    try {
      totalOre = parseNok(amountText);
    } catch {
      setAmountError('Ugyldig beløp');
      return;
    }

    const body: { totalOre?: number; kind?: LineKind } = {};
    if (totalOre !== line.totalOre) {
      body.totalOre = totalOre;
    }
    if (kind !== line.kind) {
      body.kind = kind;
    }
    if (Object.keys(body).length === 0) {
      setIsEditing(false);
      return;
    }

    updateFields.mutate(
      { lineId: line.id, ...body },
      {
        onSuccess: () => {
          showToast('Linjen er oppdatert');
          setIsEditing(false);
        },
        onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
      },
    );
  }

  function handleDelete() {
    if (!window.confirm('Slette denne linjen? Dette kan ikke angres.')) {
      return;
    }
    deleteLine.mutate(line.id, {
      onSuccess: () => showToast('Linjen er slettet'),
      onError: (mutationError) => showToast(apiErrorMessage(mutationError)),
    });
  }

  if (isEditing) {
    return (
      <div className="flex flex-col gap-3 border-b py-3">
        <p className="text-sm text-gray-600">{line.rawText}</p>

        <label htmlFor={`amount-${line.id}`} className="text-xs font-medium">
          Beløp (kr)
        </label>
        <input
          id={`amount-${line.id}`}
          type="text"
          inputMode="decimal"
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
          className="min-h-11 rounded border border-gray-400 px-3 py-2"
        />
        {amountError !== null && (
          <p role="alert" className="text-red-600">
            {amountError}
          </p>
        )}

        <label htmlFor={`kind-${line.id}`} className="text-xs font-medium">
          Type
        </label>
        <select
          id={`kind-${line.id}`}
          value={kind}
          onChange={(event) => setKind(event.target.value as LineKind)}
          className="min-h-11 rounded border border-gray-400 px-3 py-2"
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={updateFields.isPending}
            className="min-h-11 flex-1 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Lagre
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="min-h-11 rounded border border-gray-400 px-4 py-2 font-medium"
          >
            Avbryt
          </button>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteLine.isPending}
          className="min-h-11 rounded border border-red-600 px-4 py-2 font-medium text-red-600 disabled:opacity-50"
        >
          Slett linje
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-3 border-b py-3 ${isItem ? '' : 'opacity-50'}`}>
      <div className="flex-1">
        <p className="text-sm text-gray-600">{line.rawText}</p>
        <p className="text-xs text-gray-500">{formatQuantity(line.quantity, line.unit)}</p>
        {line.kind === 'item' ? (
          <ProductPicker
            key={line.product?.id ?? 'none'}
            lineId={line.id}
            receiptId={receiptId}
            currentProduct={line.product}
          />
        ) : (
          <p className="text-sm italic text-gray-500">{NON_ITEM_LABELS[line.kind]}</p>
        )}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-2">
        <p className="whitespace-nowrap font-medium">{formatOre(line.totalOre)}</p>
        <button
          type="button"
          onClick={openEdit}
          className="min-h-11 rounded border border-gray-400 px-3 text-sm font-medium"
        >
          Rediger
        </button>
      </div>
    </div>
  );
}
