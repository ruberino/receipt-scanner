import type Database from 'better-sqlite3';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { PRODUCT_CATEGORIES } from '../../shared/categories.ts';
import type { AppDatabase } from '../db/client.ts';
import { productAliases, products, receiptLines } from '../db/schema.ts';
import { normalizeText } from '../../shared/normalize.ts';
import { ExtractionError } from '../lib/errors.ts';
import { buildMatchRequest, parseMatches, type MatchResult } from '../llm/matchProducts.ts';
import type { LlmClient } from '../llm/LlmClient.ts';

const MAX_KNOWN_PRODUCTS = 1000;
const MATCH_BATCH_SIZE = 20;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export type MatchLinesDeps = {
  db: AppDatabase;
  sqlite: InstanceType<typeof Database>;
  llm: LlmClient;
  logger: FastifyBaseLogger;
  receiptId: number;
};

export type MatchLinesWarning = 'UNMATCHED_LINES' | 'MATCHING_FAILED';

export type MatchLinesResult = {
  matchedByAlias: number;
  matchedByLlm: number;
  unmatched: string[];
  warnings: MatchLinesWarning[];
};

function loadKnownProductNames(db: AppDatabase): string[] {
  return db
    .select({ name: products.name })
    .from(products)
    .leftJoin(
      receiptLines,
      and(eq(receiptLines.productId, products.id), eq(receiptLines.kind, 'item')),
    )
    .where(eq(products.suppressed, 0))
    .groupBy(products.id)
    .orderBy(desc(sql<number>`count(${receiptLines.id})`))
    .limit(MAX_KNOWN_PRODUCTS)
    .all()
    .map((row) => row.name);
}

/**
 * Matches every unmatched `item` line on the receipt to a canonical product per ADR-0004 and
 * architecture.md 7.5: alias lookup first, one LLM call for the rest, applied in one transaction.
 * Safe to call again (rematch): only lines with `product_id IS NULL` are candidates.
 */
export async function matchLines(deps: MatchLinesDeps): Promise<MatchLinesResult> {
  const { db, sqlite, llm, logger, receiptId } = deps;

  const candidates = db
    .select()
    .from(receiptLines)
    .where(
      and(
        eq(receiptLines.receiptId, receiptId),
        eq(receiptLines.kind, 'item'),
        isNull(receiptLines.productId),
      ),
    )
    .all();

  let matchedByAlias = 0;
  const keyByLineId = new Map<number, string>();
  const rawTextByKey = new Map<string, string>();
  const unmatchedLineIdsByKey = new Map<string, number[]>();

  for (const line of candidates) {
    const key = normalizeText(line.rawText);
    keyByLineId.set(line.id, key);
    if (!rawTextByKey.has(key)) {
      rawTextByKey.set(key, line.rawText);
    }

    const alias = db
      .select()
      .from(productAliases)
      .where(eq(productAliases.aliasNormalized, key))
      .get();
    if (alias) {
      db.update(receiptLines)
        .set({ productId: alias.productId, matchSource: 'alias' })
        .where(eq(receiptLines.id, line.id))
        .run();
      matchedByAlias += 1;
    } else {
      const lineIds = unmatchedLineIdsByKey.get(key) ?? [];
      lineIds.push(line.id);
      unmatchedLineIdsByKey.set(key, lineIds);
    }
  }

  const distinctUnmatchedKeys = [...unmatchedLineIdsByKey.keys()];
  if (distinctUnmatchedKeys.length === 0) {
    return { matchedByAlias, matchedByLlm: 0, unmatched: [], warnings: [] };
  }

  const knownProductNames = loadKnownProductNames(db);
  const batches = chunk(distinctUnmatchedKeys, MATCH_BATCH_SIZE);
  const matches: MatchResult['matches'] = [];
  let anyBatchFailed = false;

  for (const batchKeys of batches) {
    const batchTexts = batchKeys.map((key) => rawTextByKey.get(key) ?? key);
    try {
      const request = buildMatchRequest(batchTexts, knownProductNames, receiptId);
      const completion = await llm.completeJson(request);
      if (completion.finishReason === 'length') {
        throw new ExtractionError('Kunne ikke tolke svaret fra lesingen', 'matching', {
          cause: { finishReason: completion.finishReason, batchSize: batchTexts.length },
        });
      }
      matches.push(...parseMatches(completion.text).matches);
    } catch (error) {
      anyBatchFailed = true;
      logger.error({ err: error, receiptId, stage: 'matching' }, 'Product matching failed');
    }
  }

  const now = new Date().toISOString();
  const matchedKeys = new Set<string>();

  sqlite.transaction(() => {
    for (const match of matches) {
      const key = normalizeText(match.text);
      const lineIds = unmatchedLineIdsByKey.get(key);
      if (!lineIds || matchedKeys.has(key)) {
        continue;
      }

      let productId: number | undefined;

      if (match.existingProduct) {
        const existing = db
          .select()
          .from(products)
          .where(eq(products.nameNormalized, normalizeText(match.existingProduct)))
          .get();
        productId = existing?.id;
      }

      if (productId === undefined) {
        const newNameNormalized = normalizeText(match.newProductName);
        if (newNameNormalized === '') {
          // No existingProduct resolved and nothing usable to name a new one; leave unmatched
          // rather than create (or link everything to) a product named "".
          continue;
        }
        const existingByNewName = db
          .select()
          .from(products)
          .where(eq(products.nameNormalized, newNameNormalized))
          .get();
        if (existingByNewName) {
          productId = existingByNewName.id;
        } else {
          const category = (PRODUCT_CATEGORIES as readonly string[]).includes(match.category)
            ? match.category
            : 'Annet';
          const created = db
            .insert(products)
            .values({
              name: match.newProductName.trim(),
              nameNormalized: newNameNormalized,
              category,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          productId = created.id;
        }
      }

      db.insert(productAliases)
        .values({ aliasNormalized: key, productId, source: 'llm', createdAt: now })
        .run();

      for (const lineId of lineIds) {
        db.update(receiptLines)
          .set({ productId, matchSource: 'llm' })
          .where(eq(receiptLines.id, lineId))
          .run();
      }
      matchedKeys.add(key);
    }
  })();

  const unmatched = distinctUnmatchedKeys.filter((key) => !matchedKeys.has(key));
  let warnings: MatchLinesWarning[] = [];
  if (anyBatchFailed) {
    warnings = ['MATCHING_FAILED'];
  } else if (unmatched.length > 0) {
    warnings = ['UNMATCHED_LINES'];
  }

  return {
    matchedByAlias,
    matchedByLlm: matchedKeys.size,
    unmatched,
    warnings,
  };
}
