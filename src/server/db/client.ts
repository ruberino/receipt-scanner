import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

export type OpenedDatabase = {
  sqlite: InstanceType<typeof Database>;
  db: AppDatabase;
};

export type OpenDatabaseOptions = {
  verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
};

export function openDatabase(
  databasePath: string,
  options: OpenDatabaseOptions = {},
): OpenedDatabase {
  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath, { verbose: options.verbose });

  if (databasePath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  return { sqlite, db };
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}
