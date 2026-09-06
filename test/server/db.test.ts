import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type OpenedDatabase } from '../../src/server/db/client.ts';
import { runMigrations } from '../../src/server/db/migrate.ts';
import {
  productAliases,
  products,
  receiptImages,
  receiptLines,
  receipts,
} from '../../src/server/db/schema.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const oldMigrationsFolder = path.resolve(here, '..', 'fixtures', 'migrations', '0000-only');
const currentMigrationsFolder = path.resolve(here, '..', '..', 'drizzle');

const NOW = '2026-01-01T00:00:00.000Z';

function createDb(): OpenedDatabase {
  const opened = openDatabase(':memory:');
  runMigrations(opened.db);
  return opened;
}

function insertReceipt(
  opened: OpenedDatabase,
  overrides: Partial<typeof receipts.$inferInsert> = {},
) {
  return opened.db
    .insert(receipts)
    .values({
      status: 'done',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get();
}

function insertProduct(opened: OpenedDatabase, name: string) {
  return opened.db
    .insert(products)
    .values({
      name,
      nameNormalized: name.toUpperCase(),
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning()
    .get();
}

describe('database schema and migrations', () => {
  let opened: OpenedDatabase;

  afterEach(() => {
    opened.sqlite.close();
  });

  it('creates every table after migrating', () => {
    opened = createDb();

    const rows = opened.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '__drizzle_migrations'",
      )
      .all() as { name: string }[];

    expect(rows.map((row) => row.name).sort()).toEqual([
      'product_aliases',
      'products',
      'receipt_images',
      'receipt_lines',
      'receipts',
      'shopping_list_items',
      'shopping_lists',
    ]);
  });

  it('running migrations again does not fail or duplicate anything', () => {
    opened = createDb();

    expect(() => runMigrations(opened.db)).not.toThrow();

    const rows = opened.sqlite
      .prepare("select name from sqlite_master where type = 'table' and name = 'receipts'")
      .all();
    expect(rows).toHaveLength(1);
  });

  it('rejects an unknown receipt status', () => {
    opened = createDb();

    expect(() => insertReceipt(opened, { status: 'weird' })).toThrow(/CHECK constraint failed/);
  });

  it('accepts the new "uploaded" status', () => {
    opened = createDb();

    expect(() => insertReceipt(opened, { status: 'uploaded' })).not.toThrow();
  });

  it('keeps an existing done receipt intact when migrating from 0000 to the uploaded status check (T24)', () => {
    opened = openDatabase(':memory:');
    migrate(opened.db, { migrationsFolder: oldMigrationsFolder });

    const receipt = insertReceipt(opened, { status: 'done', storeName: 'KIWI Torshov' });

    migrate(opened.db, { migrationsFolder: currentMigrationsFolder });

    const stored = opened.db.select().from(receipts).where(eq(receipts.id, receipt.id)).get();
    expect(stored?.status).toBe('done');
    expect(stored?.storeName).toBe('KIWI Torshov');
    expect(() => insertReceipt(opened, { status: 'uploaded' })).not.toThrow();
  });

  it('rejects an unknown receipt line kind', () => {
    opened = createDb();
    const receipt = insertReceipt(opened);

    expect(() =>
      opened.db
        .insert(receiptLines)
        .values({
          receiptId: receipt.id,
          lineNo: 1,
          kind: 'x',
          rawText: 'TEST',
          totalOre: 100,
          createdAt: NOW,
        })
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects an unknown receipt line unit and an unknown match source', () => {
    opened = createDb();
    const receipt = insertReceipt(opened);

    expect(() =>
      opened.db
        .insert(receiptLines)
        .values({
          receiptId: receipt.id,
          lineNo: 1,
          kind: 'item',
          rawText: 'TEST',
          unit: 'oz',
          totalOre: 100,
          createdAt: NOW,
        })
        .run(),
    ).toThrow(/CHECK constraint failed/);

    expect(() =>
      opened.db
        .insert(receiptLines)
        .values({
          receiptId: receipt.id,
          lineNo: 1,
          kind: 'item',
          rawText: 'TEST',
          matchSource: 'guess',
          totalOre: 100,
          createdAt: NOW,
        })
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('deleting a receipt cascades to its image and lines', () => {
    opened = createDb();
    const receipt = insertReceipt(opened);
    opened.db
      .insert(receiptImages)
      .values({
        receiptId: receipt.id,
        mimeType: 'image/jpeg',
        bytes: Buffer.from('fake-jpeg-bytes'),
        width: 800,
        height: 1200,
        sha256: 'a'.repeat(64),
      })
      .run();
    opened.db
      .insert(receiptLines)
      .values({
        receiptId: receipt.id,
        lineNo: 1,
        kind: 'item',
        rawText: 'BANAN',
        totalOre: 1000,
        createdAt: NOW,
      })
      .run();

    opened.db.delete(receipts).where(eq(receipts.id, receipt.id)).run();

    expect(opened.db.select().from(receiptImages).all()).toHaveLength(0);
    expect(opened.db.select().from(receiptLines).all()).toHaveLength(0);
  });

  it('deleting a product sets receipt_lines.product_id to null and removes its aliases', () => {
    opened = createDb();
    const receipt = insertReceipt(opened);
    const product = insertProduct(opened, 'Lettmelk');
    const line = opened.db
      .insert(receiptLines)
      .values({
        receiptId: receipt.id,
        lineNo: 1,
        kind: 'item',
        rawText: 'TINE LETTMELK',
        totalOre: 2000,
        productId: product.id,
        matchSource: 'alias',
        createdAt: NOW,
      })
      .returning()
      .get();
    opened.db
      .insert(productAliases)
      .values({
        aliasNormalized: 'TINE LETTMELK',
        productId: product.id,
        source: 'user',
        createdAt: NOW,
      })
      .run();

    opened.db.delete(products).where(eq(products.id, product.id)).run();

    const remainingLine = opened.db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.id, line.id))
      .get();
    expect(remainingLine?.productId).toBeNull();
    expect(opened.db.select().from(productAliases).all()).toHaveLength(0);
  });

  it('rejects two aliases with the same alias_normalized', () => {
    opened = createDb();
    const productA = insertProduct(opened, 'Lettmelk');
    const productB = insertProduct(opened, 'Yoghurt');
    opened.db
      .insert(productAliases)
      .values({
        aliasNormalized: 'TINE LETTMELK',
        productId: productA.id,
        source: 'user',
        createdAt: NOW,
      })
      .run();

    expect(() =>
      opened.db
        .insert(productAliases)
        .values({
          aliasNormalized: 'TINE LETTMELK',
          productId: productB.id,
          source: 'llm',
          createdAt: NOW,
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects a receipt line referencing an unknown receipt', () => {
    opened = createDb();

    expect(() =>
      opened.db
        .insert(receiptLines)
        .values({
          receiptId: 999,
          lineNo: 1,
          kind: 'item',
          rawText: 'TEST',
          totalOre: 100,
          createdAt: NOW,
        })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rejects a second receipt image with the same sha256', () => {
    opened = createDb();
    const receiptA = insertReceipt(opened);
    const receiptB = insertReceipt(opened);
    opened.db
      .insert(receiptImages)
      .values({
        receiptId: receiptA.id,
        mimeType: 'image/jpeg',
        bytes: Buffer.from('same-bytes'),
        width: 800,
        height: 1200,
        sha256: 'b'.repeat(64),
      })
      .run();

    expect(() =>
      opened.db
        .insert(receiptImages)
        .values({
          receiptId: receiptB.id,
          mimeType: 'image/jpeg',
          bytes: Buffer.from('same-bytes'),
          width: 800,
          height: 1200,
          sha256: 'b'.repeat(64),
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('lets a receipt point at another receipt as a possible duplicate', () => {
    opened = createDb();
    const original = insertReceipt(opened);
    const duplicate = insertReceipt(opened, { possibleDuplicateOf: original.id });

    const stored = opened.db.select().from(receipts).where(eq(receipts.id, duplicate.id)).get();
    expect(stored?.possibleDuplicateOf).toBe(original.id);
  });

  it('applies the documented defaults for currency, warnings, attempts, suppressed, quantity and checked', () => {
    opened = createDb();
    const receipt = insertReceipt(opened);
    expect(receipt.currency).toBe('NOK');
    expect(receipt.warningsJson).toBe('[]');
    expect(receipt.attempts).toBe(0);

    const product = insertProduct(opened, 'Kaffe');
    expect(product.suppressed).toBe(0);

    const line = opened.db
      .insert(receiptLines)
      .values({
        receiptId: receipt.id,
        lineNo: 1,
        kind: 'item',
        rawText: 'KAFFE',
        totalOre: 5000,
        createdAt: NOW,
      })
      .returning()
      .get();
    expect(line.quantity).toBe(1);
  });
});
