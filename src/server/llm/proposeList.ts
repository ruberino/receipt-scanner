import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { PRODUCT_CATEGORIES, type ProductCategory } from '../../shared/categories.ts';
import { diffDays } from '../../shared/dates.ts';
import { normalizeText } from '../../shared/normalize.ts';
import { ProposalFailedError } from '../lib/errors.ts';
import type { ProposalContext } from '../domain/proposalContext.ts';
import { parseJsonObject } from './json.ts';
import type { JsonCompletionRequest, LlmClient } from './LlmClient.ts';
import { PROPOSE_PROMPT_VERSION, PROPOSE_SYSTEM_PROMPT } from './prompts/proposeList.prompt.ts';

const MAX_TOKENS = 4000;
const MAX_ITEMS = 15;
/** Matches the engine's own step 3 (T36): a product bought today or yesterday is not proposed. */
const RECENT_PURCHASE_DAYS = 1;

const proposalItemKindSchema = z.enum(['sesong', 'merkedag', 'variasjon', 'vane']);

const modelItemSchema = z.object({
  productId: z.number().int().nullable(),
  name: z.string().min(1),
  category: z.string(),
  quantityText: z.string().nullable(),
  reason: z.string(),
  kind: proposalItemKindSchema,
});

const modelResponseSchema = z.object({
  items: z.array(modelItemSchema),
});

export type ProposedItem = {
  index: number;
  productId: number | null;
  name: string;
  category: ProductCategory;
  quantityText: string | null;
  reason: string;
  kind: z.infer<typeof proposalItemKindSchema>;
};

export type ProposalResult = {
  items: ProposedItem[];
  model: string;
  promptVersion: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  rawResponse: string;
};

export function buildProposalRequest(
  context: ProposalContext,
  listId: number,
): JsonCompletionRequest {
  return {
    purpose: 'propose',
    system: PROPOSE_SYSTEM_PROMPT,
    userText: JSON.stringify(context),
    maxTokens: MAX_TOKENS,
    promptVersion: PROPOSE_PROMPT_VERSION,
    listId,
  };
}

function isProductCategory(value: string): value is ProductCategory {
  return (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Calls the LLM for a list proposal and filters its answer (T37, ADR-0016): a returned name that
 * matches one of a product's `variants` (T40, ADR-0019) is rewritten to that product's id and
 * name, whatever `productId` came with it, so a model naming a specific flavour still adds the
 * group and is filtered exactly like the group would be; drops an item whose `productId` is not
 * in the context or whose `category` is unknown, de-duplicates by normalised name (against the
 * response itself and against `listItems`), filters out anything `onList`, `dismissed`, `rejected`
 * or bought today or yesterday as a defence against the model ignoring the prompt's own rule, and
 * returns at most 15 items. Any failure — network, timeout, an answer cut off at the token budget,
 * or one that does not parse — surfaces as `ProposalFailedError`, since a proposal with no result
 * is not a useful degraded answer the way partial matching is.
 */
export async function runProposal(
  llm: LlmClient,
  context: ProposalContext,
  listId: number,
  logger?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<ProposalResult> {
  const request = buildProposalRequest(context, listId);

  let completion;
  try {
    completion = await llm.completeJson(request);
  } catch (error) {
    logger?.warn({ listId, stage: 'client', err: error }, 'Proposal call failed');
    throw new ProposalFailedError(undefined, { cause: error });
  }
  if (completion.finishReason === 'length') {
    const cause = { finishReason: completion.finishReason };
    logger?.warn(
      { listId, stage: 'length', err: cause },
      'Proposal answer was cut off at the token budget',
    );
    throw new ProposalFailedError(undefined, { cause });
  }

  let parsedJson: Record<string, unknown>;
  try {
    parsedJson = parseJsonObject(completion.text, 'proposal');
  } catch (error) {
    logger?.warn({ listId, stage: 'parse', err: error }, 'Proposal answer was not valid JSON');
    throw new ProposalFailedError(undefined, { cause: error });
  }
  const parsed = modelResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    // path/code only, never the model's text: a zod issue's own `message` can echo the input.
    const cause = parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code }));
    logger?.warn(
      { listId, stage: 'schema', err: cause },
      'Proposal answer did not match the schema',
    );
    throw new ProposalFailedError(undefined, { cause });
  }

  const productsById = new Map(context.products.map((product) => [product.id, product]));
  const listItemNames = new Set(context.listItems.map((name) => normalizeText(name)));

  // A variant's name (T40, ADR-0019) never gets its own entry in `context.products` — it is
  // folded into its parent's `variants` — so a model that names a variant by itself, instead of
  // the group, can only be recognised by that name, not by a productId it was never given.
  const childNameToParentId = new Map<string, number>();
  for (const product of context.products) {
    for (const variant of product.variants ?? []) {
      childNameToParentId.set(normalizeText(variant), product.id);
    }
  }

  let droppedUnknown = 0;
  const seenNames = new Set<string>();
  const filtered: Omit<ProposedItem, 'index'>[] = [];

  for (const item of parsed.data.items) {
    let productId = item.productId;
    let name = item.name;
    if (productId === null) {
      const parentId = childNameToParentId.get(normalizeText(name));
      if (parentId !== undefined) {
        productId = parentId;
        name = productsById.get(parentId)?.name ?? name;
      }
    }

    if (productId !== null && !productsById.has(productId)) {
      droppedUnknown += 1;
      continue;
    }
    if (!isProductCategory(item.category)) {
      droppedUnknown += 1;
      continue;
    }

    const normalizedName = normalizeText(name);
    if (seenNames.has(normalizedName)) {
      continue;
    }

    if (productId !== null) {
      const product = productsById.get(productId)!;
      if (product.onList || product.dismissed || product.rejected) {
        continue;
      }
      if (diffDays(product.lastPurchaseDate, context.today) <= RECENT_PURCHASE_DAYS) {
        continue;
      }
    } else if (listItemNames.has(normalizedName)) {
      // A new product's name might still collide with a manual item already on the list.
      continue;
    }

    seenNames.add(normalizedName);
    filtered.push({
      productId,
      name,
      category: item.category,
      quantityText: item.quantityText,
      reason: item.reason,
      kind: item.kind,
    });
  }

  if (droppedUnknown > 0) {
    logger?.warn(
      { listId, droppedUnknown },
      'Proposal dropped items with an unknown productId or category',
    );
  }

  return {
    items: filtered.slice(0, MAX_ITEMS).map((item, index) => ({ ...item, index })),
    model: completion.model,
    promptVersion: PROPOSE_PROMPT_VERSION,
    promptTokens: completion.usage.promptTokens,
    completionTokens: completion.usage.completionTokens,
    durationMs: completion.durationMs,
    rawResponse: completion.text,
  };
}
