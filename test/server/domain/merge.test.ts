import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type OpenedDatabase } from '../../../src/server/db/client.ts';
import { runMigrations } from '../../../src/server/db/migrate.ts';
import { productAliases, products, receiptLines, receipts } from '../../../src/server/db/schema.ts';
import { mergeProducts } from '../../../src/server/domain/merge.ts';
import { NotFoundError, ValidationError } from '../../../src/server/lib/errors.ts';
import { normalizeText } from '../../../src/shared/normalize.ts';

const NOW = '2026-09-03T12:00:00.000Z';

let opened: OpenedDatabase;

function createDb(): OpenedDatabase {
  const db = openDatabase(':memory:');
  runMigrations(db.db);
  return db;
}

function insertProduct(
  name: string,
  overrides: Partial<typeof products.$inferInsert> = {},
): number {
  return opened.db
    .insert(products)
    .values({
      name,
      nameNormalized: normalizeText(name),
      category: 'Meieri',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get().id;
}

function insertReceipt(): number {
  return opened.db
    .insert(receipts)
    .values({ status: 'done', warningsJson: '[]', createdAt: NOW, updatedAt: NOW })
    .returning()
    .get().id;
}

function insertLine(receiptId: number, productId: number): number {
  return opened.db
    .insert(receiptLines)
    .values({
      receiptId,
      lineNo: 1,
      kind: 'item',
      rawText: 'line',
      totalOre: 100,
      productId,
      createdAt: NOW,
    })
    .returning()
    .get().id;
}

function insertAlias(
  aliasNormalized: string,
  productId: number,
  source: 'llm' | 'user' = 'user',
): void {
  opened.db
    .insert(productAliases)
    .values({ aliasNormalized, productId, source, createdAt: NOW })
    .run();
}

function aliasesOf(productId: number) {
  return opened.db
    .select()
    .from(productAliases)
    .where(eq(productAliases.productId, productId))
    .all();
}

afterEach(() => {
  opened.sqlite.close();
});

describe('mergeProducts', () => {
  it('moves lines and aliases, adds the source name as an alias of the target, and deletes the source', () => {
    opened = createDb();
    const source = insertProduct('COOP Lettmelk');
    const target = insertProduct('TINE Lettmelk 1 l');
    insertAlias('GAMMEL MELK', source);
    const r1 = insertReceipt();
    const r2 = insertReceipt();
    const r3 = insertReceipt();
    insertLine(r1, source);
    insertLine(r2, source);
    insertLine(r3, target);

    const result = mergeProducts(opened.sqlite, opened.db, source, target);

    expect(result.id).toBe(target);
    expect(opened.db.select().from(products).where(eq(products.id, source)).get()).toBeUndefined();

    const lines = opened.db.select().from(receiptLines).all();
    expect(lines.every((line) => line.productId === target)).toBe(true);

    const aliases = aliasesOf(target);
    expect(aliases.map((a) => a.aliasNormalized).sort()).toEqual(['COOP LETTMELK', 'GAMMEL MELK']);
  });

  it('does not duplicate an alias for the source name when it already exists on the target', () => {
    opened = createDb();
    const source = insertProduct('COOP Lettmelk');
    const target = insertProduct('TINE Lettmelk 1 l');
    insertAlias('COOP LETTMELK', target);

    mergeProducts(opened.sqlite, opened.db, source, target);

    const aliases = aliasesOf(target);
    expect(aliases.filter((a) => a.aliasNormalized === 'COOP LETTMELK')).toHaveLength(1);
  });

  it('throws ValidationError when the ids are equal', () => {
    opened = createDb();
    const productId = insertProduct('Lettmelk');

    expect(() => mergeProducts(opened.sqlite, opened.db, productId, productId)).toThrow(
      ValidationError,
    );
  });

  it('throws NotFoundError when the source is missing', () => {
    opened = createDb();
    const target = insertProduct('Lettmelk');

    expect(() => mergeProducts(opened.sqlite, opened.db, 999, target)).toThrow(NotFoundError);
  });

  it('throws NotFoundError when the target is missing', () => {
    opened = createDb();
    const source = insertProduct('Lettmelk');

    expect(() => mergeProducts(opened.sqlite, opened.db, source, 999)).toThrow(NotFoundError);
  });

  it('leaves no dangling data: a later line matching the source name aliases to the target', () => {
    opened = createDb();
    const source = insertProduct('COOP Lettmelk');
    const target = insertProduct('TINE Lettmelk 1 l');

    mergeProducts(opened.sqlite, opened.db, source, target);

    const alias = opened.db
      .select()
      .from(productAliases)
      .where(eq(productAliases.aliasNormalized, 'COOP LETTMELK'))
      .get();
    expect(alias?.productId).toBe(target);
  });
});
