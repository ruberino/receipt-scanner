import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  blob,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const receipts = sqliteTable(
  'receipts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    status: text('status').notNull(),
    storeName: text('store_name'),
    purchasedAt: text('purchased_at'),
    totalOre: integer('total_ore'),
    currency: text('currency').notNull().default('NOK'),
    warningsJson: text('warnings_json').notNull().default('[]'),
    extractionJson: text('extraction_json'),
    rawResponse: text('raw_response'),
    promptVersion: integer('prompt_version'),
    model: text('model'),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    possibleDuplicateOf: integer('possible_duplicate_of').references(
      (): AnySQLiteColumn => receipts.id,
      { onDelete: 'set null' },
    ),
    reviewedAt: text('reviewed_at'),
    /** The list this receipt was bought for (T39, ADR-0018); set automatically by
     * `findTripList` when the receipt reaches `done` or the list is completed, overridable on
     * the receipt page. Several receipts can point at one list; a receipt at most one list. */
    shoppingListId: integer('shopping_list_id').references(
      (): AnySQLiteColumn => shoppingLists.id,
      { onDelete: 'set null' },
    ),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'receipts_status_check',
      sql`${table.status} in ('uploaded', 'pending', 'processing', 'done', 'failed')`,
    ),
    index('receipts_shopping_list').on(table.shoppingListId),
  ],
);

export const receiptImages = sqliteTable('receipt_images', {
  receiptId: integer('receipt_id')
    .primaryKey()
    .references(() => receipts.id, { onDelete: 'cascade' }),
  mimeType: text('mime_type').notNull(),
  bytes: blob('bytes', { mode: 'buffer' }).notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  sha256: text('sha256').notNull().unique(),
});

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull().unique(),
    category: text('category'),
    suppressed: integer('suppressed').notNull().default(0),
    /** The group this product is a variant of (T40, ADR-0019); depth exactly one, enforced in the
     * route handlers, not here. A parent is an ordinary product row and may have receipt lines of
     * its own. */
    parentId: integer('parent_id').references((): AnySQLiteColumn => products.id, {
      onDelete: 'set null',
    }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('products_parent').on(table.parentId)],
);

export const productAliases = sqliteTable(
  'product_aliases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    aliasNormalized: text('alias_normalized').notNull().unique(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [check('product_aliases_source_check', sql`${table.source} in ('llm', 'user')`)],
);

export const receiptLines = sqliteTable(
  'receipt_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    receiptId: integer('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    kind: text('kind').notNull(),
    rawText: text('raw_text').notNull(),
    quantity: real('quantity').notNull().default(1),
    unit: text('unit'),
    unitPriceOre: integer('unit_price_ore'),
    totalOre: integer('total_ore').notNull(),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    matchSource: text('match_source'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check(
      'receipt_lines_kind_check',
      sql`${table.kind} in ('item', 'discount', 'deposit', 'other')`,
    ),
    check(
      'receipt_lines_unit_check',
      sql`${table.unit} is null or ${table.unit} in ('stk', 'kg', 'l')`,
    ),
    check(
      'receipt_lines_match_source_check',
      sql`${table.matchSource} is null or ${table.matchSource} in ('alias', 'llm', 'user')`,
    ),
    index('receipt_lines_receipt').on(table.receiptId, table.lineNo),
    index('receipt_lines_product').on(table.productId),
  ],
);

export const shoppingLists = sqliteTable(
  'shopping_lists',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    weekStart: text('week_start').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [check('shopping_lists_status_check', sql`${table.status} in ('open', 'done')`)],
);

export const shoppingListItems = sqliteTable(
  'shopping_list_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    listId: integer('list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    quantityText: text('quantity_text'),
    source: text('source').notNull(),
    reason: text('reason'),
    checked: integer('checked').notNull().default(0),
    position: integer('position').notNull(),
    /** Set from the AI proposal when the item has no product, otherwise null (T37); a product's
     * own category always wins, this is only the fallback for a novel item `accept` inserted. */
    category: text('category'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check(
      'shopping_list_items_source_check',
      sql`${table.source} in ('suggested', 'manual', 'ai')`,
    ),
    index('shopping_list_items_list').on(table.listId, table.position),
  ],
);

/** A product removed from a list is never re-suggested to that same list by a refresh (T34). */
export const shoppingListDismissals = sqliteTable(
  'shopping_list_dismissals',
  {
    listId: integer('list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.listId, table.productId] })],
);

/** One `Foreslå med AI` call and its outcome (T37, ADR-0016); `accepted_json` is null until the
 * user accepts or cancels, and once set makes a second accept on the same proposal a 409. */
export const shoppingListProposals = sqliteTable(
  'shopping_list_proposals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    listId: integer('list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    promptVersion: integer('prompt_version').notNull(),
    itemsJson: text('items_json').notNull(),
    rawResponse: text('raw_response').notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    durationMs: integer('duration_ms').notNull(),
    acceptedJson: text('accepted_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('shopping_list_proposals_list').on(table.listId)],
);
