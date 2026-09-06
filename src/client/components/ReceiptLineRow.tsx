import type { ReceiptLine } from '../../shared/schemas.ts';
import { formatOre } from '../lib/format.ts';
import ProductPicker from './ProductPicker.tsx';

const NON_ITEM_LABELS: Record<Exclude<ReceiptLine['kind'], 'item'>, string> = {
  discount: 'Rabatt',
  deposit: 'Pant',
  other: 'Annet',
};

function formatQuantity(quantity: number, unit: ReceiptLine['unit']): string {
  const formattedQuantity = String(quantity).replace('.', ',');
  return unit === null ? formattedQuantity : `${formattedQuantity} ${unit}`;
}

type ReceiptLineRowProps = {
  line: ReceiptLine;
  receiptId: number;
};

export default function ReceiptLineRow({ line, receiptId }: ReceiptLineRowProps) {
  const isItem = line.kind === 'item';

  return (
    <div className={`flex items-start gap-3 border-b py-3 ${isItem ? '' : 'opacity-50'}`}>
      <div className="flex-1">
        <p className="text-sm text-gray-600">{line.rawText}</p>
        <p className="text-xs text-gray-500">{formatQuantity(line.quantity, line.unit)}</p>
        {line.kind === 'item' ? (
          <ProductPicker lineId={line.id} receiptId={receiptId} currentProduct={line.product} />
        ) : (
          <p className="text-sm italic text-gray-500">{NON_ITEM_LABELS[line.kind]}</p>
        )}
      </div>
      <p className="whitespace-nowrap font-medium">{formatOre(line.totalOre)}</p>
    </div>
  );
}
