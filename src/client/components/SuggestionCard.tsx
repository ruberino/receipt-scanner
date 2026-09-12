import type { Suggestion } from '../../shared/schemas.ts';

/** Compact row (T32): name and quantity share the first line, the reason sits below it in grey. */
export default function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  return (
    <li className="flex flex-col py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate">{suggestion.name}</span>

        <span className="flex-shrink-0 meta">{suggestion.quantityText}</span>
      </div>
      <span className="meta">{suggestion.reason}</span>
    </li>
  );
}
