import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { OpenedDatabase } from './client.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '..', '..', '..', 'drizzle');

type ForeignKeyCheckRow = { table: string; rowid: number | null; parent: string; fkid: number };

/**
 * drizzle wraps every migration statement in one BEGIN…COMMIT, and SQLite ignores
 * `PRAGMA foreign_keys` inside a transaction, so a table-recreate migration's own
 * `DROP TABLE` would otherwise run with foreign keys still on and cascade-delete
 * every child row (see docs/architecture.md, migrations).
 */
export function runMigrations({ sqlite, db }: OpenedDatabase): void {
  sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(db, { migrationsFolder });
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }

  const violations = sqlite.pragma('foreign_key_check') as ForeignKeyCheckRow[];
  if (violations.length > 0) {
    throw new Error(`Migration left dangling foreign keys: ${JSON.stringify(violations)}`);
  }
}
