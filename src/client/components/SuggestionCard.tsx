import type { Suggestion } from '../../shared/schemas.ts';

/** Compact row (T32): name and quantity share the first line, the reason sits below it in grey. */
export default function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  return (
    <li className="flex flex-col gap-0.5 border-b border-gray-200 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{suggestion.name}</span>
        <span className="flex-shrink-0 text-sm text-gray-500">{suggestion.quantityText}</span>
      </div>
      <span className="text-sm text-gray-500">{suggestion.reason}</span>
    </li>
  );
}
