import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.ts';
import { productAliases, products, receiptLines } from '../db/schema.ts';
import { NotFoundError, ValidationError } from '../lib/errors.ts';
import { normalizeText } from '../../shared/normalize.ts';

/**
 * Merges `sourceId` into `targetId`: every receipt line and alias pointing at the source is moved
 * to the target, the source's own name becomes an alias of the target unless that normalised name
 * is already claimed by an existing alias, and the source product row is deleted. Returns the
 * (unchanged) target row.
 */
export function mergeProducts(
  sqlite: InstanceType<typeof Database>,
  db: AppDatabase,
  sourceId: number,
  targetId: number,
): typeof products.$inferSelect {
  if (sourceId === targetId) {
    throw new ValidationError('Kan ikke slå sammen et produkt med seg selv');
  }

  return sqlite.transaction(() => {
    const source = db.select().from(products).where(eq(products.id, sourceId)).get();
    const target = db.select().from(products).where(eq(products.id, targetId)).get();
    if (!source || !target) {
      throw new NotFoundError();
    }

    db.update(receiptLines)
      .set({ productId: targetId })
      .where(eq(receiptLines.productId, sourceId))
      .run();

    db.update(productAliases)
      .set({ productId: targetId })
      .where(eq(productAliases.productId, sourceId))
      .run();

    const nameAlias = normalizeText(source.name);
    const existingAlias = db
      .select()
      .from(productAliases)
      .where(eq(productAliases.aliasNormalized, nameAlias))
      .get();
    if (!existingAlias) {
      db.insert(productAliases)
        .values({
          aliasNormalized: nameAlias,
          productId: targetId,
          source: 'user',
          createdAt: new Date().toISOString(),
        })
        .run();
    }

    db.delete(products).where(eq(products.id, sourceId)).run();

    return target;
  })();
}
