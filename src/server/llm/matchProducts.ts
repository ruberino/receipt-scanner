import { z } from 'zod';
import { ExtractionError } from '../lib/errors.ts';
import { parseJsonObject } from './json.ts';
import type { JsonCompletionRequest } from './LlmClient.ts';
import { MATCH_PROMPT_VERSION, MATCH_SYSTEM_PROMPT } from './prompts/matchProducts.prompt.ts';

const MAX_TOKENS = 2000;

export const matchResultSchema = z.object({
  matches: z.array(
    z.object({
      text: z.string(),
      existingProduct: z.string().nullable(),
      newProductName: z.string(),
      category: z.string(),
    }),
  ),
});

export type MatchResult = z.infer<typeof matchResultSchema>;

export function buildMatchRequest(
  texts: string[],
  knownProductNames: string[],
  receiptId?: number,
): JsonCompletionRequest {
  const userText = [
    'Unmatched receipt texts:',
    ...texts.map((text) => `- ${text}`),
    '',
    'Known products (use exactly one of these for existingProduct when it matches, otherwise null):',
    ...(knownProductNames.length > 0
      ? knownProductNames.map((name) => `- ${name}`)
      : ['(none yet)']),
  ].join('\n');

  return {
    purpose: 'match',
    system: MATCH_SYSTEM_PROMPT,
    userText,
    maxTokens: MAX_TOKENS,
    promptVersion: MATCH_PROMPT_VERSION,
    receiptId,
  };
}

/** Parses and validates one LLM completion's text; throws ExtractionError('Kunne ikke tolke svaret fra lesingen'). */
export function parseMatches(text: string): MatchResult {
  const json = parseJsonObject(text, 'matching');
  const parsed = matchResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new ExtractionError('Kunne ikke tolke svaret fra lesingen', 'matching');
  }
  return parsed.data;
}
