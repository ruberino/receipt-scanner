import { z } from 'zod';
import { isIsoDate } from '../../shared/dates.ts';
import { parseDecimal } from '../../shared/money.ts';
import { ExtractionError } from '../lib/errors.ts';
import { parseJsonObject } from './json.ts';
import type { JsonCompletionRequest, LlmClient } from './LlmClient.ts';
import { EXTRACT_PROMPT_VERSION, EXTRACT_SYSTEM_PROMPT } from './prompts/extractReceipt.prompt.ts';

const MAX_TOKENS = 6000;
const UNITS = new Set(['stk', 'kg', 'l']);
const KINDS = new Set(['item', 'discount', 'deposit', 'other']);

/** Parses a number or a decimal-comma string; returns undefined instead of throwing on anything else. */
function tryParseDecimal(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  try {
    const parsed = parseDecimal(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const rawLineSchema = z.object({
  text: z.string().min(1).max(120),
  kind: z.enum(['item', 'discount', 'deposit', 'other']),
  quantity: z.number().positive(),
  unit: z.enum(['stk', 'kg', 'l']).nullable(),
  unitPrice: z.number().nullable(),
  totalPrice: z.number(),
});

/**
 * Lenient normalisation per architecture.md 7.3: unknown kind -> other; missing/non-numeric/non-positive
 * quantity -> 1; a missing/null unit is valid and keeps the parsed quantity; g/hg/ml/cl/dl convert to
 * kg/l; any other (non-null) unit string -> null with quantity reset to 1.
 * Only a missing/empty text or a totalPrice that fails to parse make this line fail validation.
 */
const lineSchema = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null) {
    return raw;
  }
  const r = raw as Record<string, unknown>;

  const text = typeof r.text === 'string' ? r.text.trim().slice(0, 120) : '';
  const kind = typeof r.kind === 'string' && KINDS.has(r.kind) ? r.kind : 'other';

  let quantity = tryParseDecimal(r.quantity);
  if (quantity === undefined || quantity <= 0) {
    quantity = 1;
  }

  const rawUnit = typeof r.unit === 'string' ? r.unit.toLowerCase() : null;
  let unit: 'stk' | 'kg' | 'l' | null;
  if (rawUnit === null) {
    // A missing or null unit is documented as valid ("stk, kg, l or null"); keep the parsed quantity.
    unit = null;
  } else if (UNITS.has(rawUnit)) {
    unit = rawUnit as 'stk' | 'kg' | 'l';
  } else if (rawUnit === 'g') {
    quantity /= 1000;
    unit = 'kg';
  } else if (rawUnit === 'hg') {
    quantity /= 10;
    unit = 'kg';
  } else if (rawUnit === 'ml') {
    quantity /= 1000;
    unit = 'l';
  } else if (rawUnit === 'cl') {
    quantity /= 100;
    unit = 'l';
  } else if (rawUnit === 'dl') {
    quantity /= 10;
    unit = 'l';
  } else {
    unit = null;
    quantity = 1;
  }

  return {
    text,
    kind,
    quantity,
    unit,
    unitPrice: tryParseDecimal(r.unitPrice) ?? null,
    // Left undefined (not defaulted) when unparsable, so z.number() below is the one hard failure.
    totalPrice: tryParseDecimal(r.totalPrice),
  };
}, rawLineSchema);

export const extractionResultSchema = z.object({
  storeName: z.preprocess((value) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed.slice(0, 80);
  }, z.string().max(80).nullable()),
  purchasedAt: z.preprocess((value) => {
    return typeof value === 'string' && isIsoDate(value) ? value : null;
  }, z.string().nullable()),
  total: z.preprocess((value) => tryParseDecimal(value) ?? null, z.number().nullable()),
  // Truncated, not failed: "lines at most 200" is a normalisation constraint, not one of the three
  // documented hard-failure conditions.
  lines: z.preprocess(
    (value) => (Array.isArray(value) ? value.slice(0, 200) : value),
    z.array(lineSchema),
  ),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export function buildExtractionRequest(
  imageDataUrl: string,
  receiptId?: number,
): JsonCompletionRequest {
  return {
    purpose: 'extract',
    system: EXTRACT_SYSTEM_PROMPT,
    userText: 'Extract this receipt as JSON, following the schema and rules exactly.',
    imageDataUrl,
    maxTokens: MAX_TOKENS,
    promptVersion: EXTRACT_PROMPT_VERSION,
    receiptId,
  };
}

/** Parses and validates one LLM completion's text; throws ExtractionError('Kunne ikke tolke svaret fra lesingen'). */
export function parseExtraction(text: string): ExtractionResult {
  const json = parseJsonObject(text, 'extraction');
  const parsed = extractionResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new ExtractionError('Kunne ikke tolke svaret fra lesingen', 'extraction');
  }
  return parsed.data;
}

export type ExtractionRunResult = {
  result: ExtractionResult;
  raw: string;
  model: string;
  promptVersion: number;
  usage: { promptTokens: number; completionTokens: number };
};

export async function runExtraction(
  llm: LlmClient,
  imageDataUrl: string,
  receiptId?: number,
): Promise<ExtractionRunResult> {
  const request = buildExtractionRequest(imageDataUrl, receiptId);
  const completion = await llm.completeJson(request);

  if (completion.finishReason === 'length') {
    throw new ExtractionError('Kvitteringen var for lang til å leses', 'extraction');
  }

  const result = parseExtraction(completion.text);

  return {
    result,
    raw: completion.text,
    model: completion.model,
    promptVersion: EXTRACT_PROMPT_VERSION,
    usage: completion.usage,
  };
}
