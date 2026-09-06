import type { Suggestion } from '../../shared/schemas.ts';

export default function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  return (
    <li className="flex flex-col gap-1 rounded border border-gray-200 p-4">
      <span className="font-medium">{suggestion.name}</span>
      <span className="text-sm text-gray-600">{suggestion.reason}</span>
      <span className="text-sm text-gray-500">{suggestion.quantityText}</span>
    </li>
  );
}
