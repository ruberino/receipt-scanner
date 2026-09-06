import { ExtractionError, type ExtractionStage } from '../lib/errors.ts';

const FENCED_BLOCK = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** Parses a JSON object from LLM output, tolerating a leading/trailing markdown code fence. */
export function parseJsonObject(text: string, stage: ExtractionStage): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = FENCED_BLOCK.exec(trimmed);
  const candidate = fenced ? (fenced[1] ?? '') : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new ExtractionError('Kunne ikke tolke svaret fra lesingen', stage);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ExtractionError('Kunne ikke tolke svaret fra lesingen', stage);
  }

  return parsed as Record<string, unknown>;
}
