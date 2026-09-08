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
  shoppingListDismissals,
  shoppingListItems,
  shoppingListProposals,
  shoppingLists,
} from '../../src/server/db/schema.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const oldMigrationsFolder = path.resolve(here, '..', 'fixtures', 'migrations', '0000-only');
const preDismissalsMigrationsFolder = path.resolve(
  here,
  '..',
  'fixtures',
  'migrations',
  '0001-only',
);
const preProposalsMigrationsFolder = path.resolve(
  here,
  '..',
  'fixtures',
  'migrations',
  '0002-only',
);
const preCategoryMigrationsFolder = path.resolve(here, '..', 'fixtures', 'migrations', '0004-only');
const preShoppingListLinkMigrationsFolder = path.resolve(
  here,
  '..',
  'fixtures',
  'migrations',
  '0005-only',
);
const preParentIdMigrationsFolder = path.resolve(here, '..', 'fixtures', 'migrations', '0006-only');

const NOW = '2026-01-01T00:00:00.000Z';

function createDb(): OpenedDatabase {
  const opened = openDatabase(':memory:');
  runMigrations(opened);
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

function insertProduct(
  opened: OpenedDatabase,
  name: string,
  overrides: Partial<typeof products.$inferInsert> = {},
) {
  return opened.db
    .insert(products)
    .values({
      name,
      nameNormalized: name.toUpperCase(),
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
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
      'shopping_list_dismissals',
      'shopping_list_items',
      'shopping_list_proposals',
      'shopping_lists',
    ]);
  });

  it('running migrations again does not fail or duplicate anything', () => {
    opened = createDb();

    expect(() => runMigrations(opened)).not.toThrow();

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

  it('keeps an existing done receipt, its line and its image intact when migrating from 0000 to the uploaded status check (T24)', () => {
    opened = openDatabase(':memory:');
    migrate(opened.db, { migrationsFolder: oldMigrationsFolder });

    // Raw SQL, not the `insertReceipt` helper: the live `receipts` schema object now has
    // `shopping_list_id` too (T39), which the table this fixture recreates does not have yet.
    const receiptId = Number(
      opened.sqlite
        .prepare(
          `insert into receipts (status, store_name, warnings_json, created_at, updated_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run('done', 'KIWI Torshov', '[]', NOW, NOW).lastInsertRowid,
    );
    const receipt = { id: receiptId };
    const line = opened.db
      .insert(receiptLines)
      .values({
        receiptId: receipt.id,
        lineNo: 1,
        kind: 'item',
        rawText: 'BANAN',
        totalOre: 1000,
        createdAt: NOW,
      })
      .returning()
      .get();
    opened.db
      .insert(receiptImages)
      .values({
        receiptId: receipt.id,
        mimeType: 'image/jpeg',
        bytes: Buffer.from('fake-jpeg-bytes'),
        width: 800,
        height: 1200,
        sha256: 'c'.repeat(64),
      })
      .run();

    runMigrations(opened);

    const stored = opened.db.select().from(receipts).where(eq(receipts.id, receipt.id)).get();
    expect(stored?.status).toBe('done');
    expect(stored?.storeName).toBe('KIWI Torshov');
    expect(
      opened.db.select().from(receiptLines).where(eq(receiptLines.id, line.id)).get(),
    ).toBeDefined();
    expect(
      opened.db.select().from(receiptImages).where(eq(receiptImages.receiptId, receipt.id)).get(),
    ).toBeDefined();
    expect(() => insertReceipt(opened, { status: 'uploaded' })).not.toThrow();
  });

  it('keeps an existing open list and its items intact when migrating in shopping_list_dismissals (T34)', () => {
    opened = openDatabase(':memory:');
    migrate(opened.db, { migrationsFolder: preDismissalsMigrationsFolder });

    const list = opened.db
      .insert(shoppingLists)
      .values({ weekStart: '2026-08-31', status: 'open', createdAt: NOW })
      .returning()
      .get();
    // Raw SQL, not `insertProduct`: the live `products` schema object now has `parent_id` too
    // (T40), which the old table this fixture recreates does not have yet.
    const productId = Number(
      opened.sqlite
        .prepare(
          `insert into products (name, name_normalized, created_at, updated_at) values (?, ?, ?, ?)`,
        )
        .run('Lettmelk', 'LETTMELK', NOW, NOW).lastInsertRowid,
    );
    // Raw SQL, not the drizzle query builder: the live `shoppingListItems` schema object now has
    // `category` too, and drizzle's insert names every schema column, which the old table this
    // fixture recreates does not have yet (T37 F2).
    const itemId = Number(
      opened.sqlite
        .prepare(
          `insert into shopping_list_items (list_id, product_id, name, source, checked, position, created_at)
           values (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(list.id, productId, 'Lettmelk 1 l', 'suggested', 0, 1, NOW).lastInsertRowid,
    );

    runMigrations(opened);

    expect(
      opened.db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id)).get(),
    ).toMatchObject({ status: 'open', weekStart: '2026-08-31' });
    expect(
      opened.db.select().from(shoppingListItems).where(eq(shoppingListItems.id, itemId)).get(),
    ).toMatchObject({ name: 'Lettmelk 1 l', productId });
    expect(() =>
      opened.db
        .insert(shoppingListDismissals)
        .values({ listId: list.id, productId, createdAt: NOW })
        .run(),
    ).not.toThrow();
  });

  it('keeps an existing list, item and dismissal intact when migrating in shopping_list_proposals and the "ai" source (T37)', () => {
    opened = openDatabase(':memory:');
    migrate(opened.db, { migrationsFolder: preProposalsMigrationsFolder });

    const list = opened.db
      .insert(shoppingLists)
      .values({ weekStart: '2026-08-31', status: 'open', createdAt: NOW })
      .returning()
      .get();
    // Raw SQL, not `insertProduct`: the live `products` schema object now has `parent_id` too
    // (T40), which the old table this fixture recreates does not have yet.
    const productId = Number(
      opened.sqlite
        .prepare(
          `insert into products (name, name_normalized, created_at, updated_at) values (?, ?, ?, ?)`,
        )
        .run('Lettmelk', 'LETTMELK', NOW, NOW).lastInsertRowid,
    );
    // Raw SQL, see the T34 test above: the pre-T37 fixture predates `category`.
    const itemId = Number(
      opened.sqlite
        .prepare(
          `insert into shopping_list_items (list_id, product_id, name, source, checked, position, created_at)
           values (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(list.id, productId, 'Lettmelk 1 l', 'suggested', 0, 1, NOW).lastInsertRowid,
    );
    const dismissal = opened.db
      .insert(shoppingListDismissals)
      .values({ listId: list.id, productId, createdAt: NOW })
      .returning()
      .get();

    runMigrations(opened);

    expect(
      opened.db.select().from(shoppingLists).where(eq(shoppingLists.id, list.id)).get(),
    ).toMatchObject({ status: 'open', weekStart: '2026-08-31' });
    expect(
      opened.db.select().from(shoppingListItems).where(eq(shoppingListItems.id, itemId)).get(),
    ).toMatchObject({ name: 'Lettmelk 1 l', productId, source: 'suggested' });
    expect(
      opened.db
        .select()
        .from(shoppingListDismissals)
        .where(eq(shoppingListDismissals.listId, dismissal.listId))
        .get(),
    ).toMatchObject({ productId });
    expect(() =>
      opened.db
        .insert(shoppingListItems)
        .values({
          listId: list.id,
          productId: null,
          name: 'AI-forslag',
          source: 'ai',
          checked: 0,
          position: 2,
          createdAt: NOW,
        })
        .run(),
    ).not.toThrow();
    expect(() =>
      opened.db
        .insert(shoppingListProposals)
        .values({
          listId: list.id,
          model: 'grok-4.6',
          promptVersion: 1,
          itemsJson: '[]',
          rawResponse: '{}',
          promptTokens: 100,
          completionTokens: 50,
          durationMs: 1000,
          createdAt: NOW,
        })
        .run(),
    ).not.toThrow();
  });

  it('keeps an existing item intact, with category null, when migrating in shopping_list_items.category (T37 F2)', () => {
    opened = openDatabase(':memory:');
    migrate(opened.db, { migrationsFolder: preCategoryMigrationsFolder });

    const list = opened.db
      .insert(shoppingLists)
      .values({ weekStart: '2026-08-31', status: 'open', createdAt: NOW })
      .returning()
      .get();
    // Raw SQL, not the drizzle query builder: it names every column of the live schema, including
    // `category`, which the table this fixture recreates does not have yet.
    const itemId = Number(
      opened.sqlite
        .prepare(
          `insert into shopping_list_items (list_id, name, source, checked, position, created_at)
           values (?, ?, ?, ?, ?, ?)`,
        )
        .run(list.id, 'Handlenett', 'manual', 0, 1, NOW).lastInsertRowid,
    );

    runMigrations(opened);

    const stored = opened.db
      .select()
      .from(shoppingListItems)
      .where(eq(shoppingListItems.id, itemId))
      .get();
    expect(stored).toMatchObject({ name: 'Handlenett', category: null });
    expect(() =>
      opened.db
        .insert(shoppingListItems)
        .values({
          listId: list.id,
          name: 'Plommer',
          source: 'ai',
          category: 'Frukt og grønt',
          checked: 0,
          position: 2,
          createdAt: NOW,
        })
        .run(),
    ).not.toThrow();
  });

  it('keeps an existing receipt intact, with shopping_list_id null, when migrating in receipts.shopping_list_id (T39)', () => {
    opened = openDatabase(':memory:');
    migrate(opened.db, { migrationsFolder: preShoppingListLinkMigrationsFolder });

    // Raw SQL: the live `receipts` schema object now has `shopping_list_id` too, which the table
    // this fixture recreates does not have yet.
    const receiptId = Number(
      opened.sqlite
        .prepare(
          `insert into receipts (status, warnings_json, created_at, updated_at) values (?, ?, ?, ?)`,
        )
        .run('done', '[]', NOW, NOW).lastInsertRowid,
    );

    runMigrations(opened);

    const stored = opened.db.select().from(receipts).where(eq(receipts.id, receiptId)).get();
    expect(stored).toMatchObject({ status: 'done', shoppingListId: null });

    const list = opened.db
      .insert(shoppingLists)
      .values({ weekStart: '2026-08-31', status: 'open', createdAt: NOW })
      .returning()
      .get();
    expect(() =>
      opened.db
        .update(receipts)
        .set({ shoppingListId: list.id })
        .where(eq(receipts.id, receiptId))
        .run(),
    ).not.toThrow();
  });

  it("deleting a shopping list sets a linked receipt's shopping_list_id to null (T39)", () => {
    opened = createDb();
    const list = opened.db
      .insert(shoppingLists)
      .values({ weekStart: '2026-08-31', status: 'done', createdAt: NOW, completedAt: NOW })
      .returning()
      .get();
    const receipt = insertReceipt(opened, { shoppingListId: list.id });

    opened.db.delete(shoppingLists).where(eq(shoppingLists.id, list.id)).run();

    const stored = opened.db.select().from(receipts).where(eq(receipts.id, receipt.id)).get();
    expect(stored?.shoppingListId).toBeNull();
  });

  it('keeps an existing product intact, with parent_id null, when migrating in products.parent_id (T40)', () => {
    opened = openDatabase(':memory:');
    migrate(opened.db, { migrationsFolder: preParentIdMigrationsFolder });

    // Raw SQL: the live `products` schema object now has `parent_id` too, which the table this
    // fixture recreates does not have yet.
    const productId = Number(
      opened.sqlite
        .prepare(
          `insert into products (name, name_normalized, suppressed, created_at, updated_at)
           values (?, ?, ?, ?, ?)`,
        )
        .run('Skyr mini', 'SKYR MINI', 0, NOW, NOW).lastInsertRowid,
    );

    runMigrations(opened);

    const stored = opened.db.select().from(products).where(eq(products.id, productId)).get();
    expect(stored).toMatchObject({ name: 'Skyr mini', parentId: null });

    const child = insertProduct(opened, 'Skyr mini jordbær');
    expect(() =>
      opened.db
        .update(products)
        .set({ parentId: productId })
        .where(eq(products.id, child.id))
        .run(),
    ).not.toThrow();
  });

  it("deleting a parent product sets its children's parent_id to null (T40)", () => {
    opened = createDb();
    const parent = insertProduct(opened, 'Skyr mini');
    const child = insertProduct(opened, 'Skyr mini jordbær', { parentId: parent.id });

    opened.db.delete(products).where(eq(products.id, parent.id)).run();

    const stored = opened.db.select().from(products).where(eq(products.id, child.id)).get();
    expect(stored?.parentId).toBeNull();
  });

  it('rejects an unknown shopping_list_items source', () => {
    opened = createDb();
    const list = opened.db
      .insert(shoppingLists)
      .values({ weekStart: '2026-08-31', status: 'open', createdAt: NOW })
      .returning()
      .get();

    expect(() =>
      opened.db
        .insert(shoppingListItems)
        .values({
          listId: list.id,
          name: 'Test',
          source: 'weird',
          checked: 0,
          position: 1,
          createdAt: NOW,
        })
        .run(),
    ).toThrow(/CHECK constraint failed/);
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

  it('deleting a list or a product cascades its dismissals (T34)', () => {
    opened = createDb();
    const listA = opened.db
      .insert(shoppingLists)
      .values({ weekStart: '2026-08-31', status: 'open', createdAt: NOW })
      .returning()
      .get();
    const listB = opened.db
      .insert(shoppingLists)
      .values({ weekStart: '2026-09-07', status: 'open', createdAt: NOW })
      .returning()
      .get();
    const product = insertProduct(opened, 'Lettmelk');
    opened.db
      .insert(shoppingListDismissals)
      .values({ listId: listA.id, productId: product.id, createdAt: NOW })
      .run();
    opened.db
      .insert(shoppingListDismissals)
      .values({ listId: listB.id, productId: product.id, createdAt: NOW })
      .run();

    opened.db.delete(shoppingLists).where(eq(shoppingLists.id, listA.id)).run();
    expect(opened.db.select().from(shoppingListDismissals).all()).toHaveLength(1);

    opened.db.delete(products).where(eq(products.id, product.id)).run();
    expect(opened.db.select().from(shoppingListDismissals).all()).toHaveLength(0);
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
