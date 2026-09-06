import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { AppDatabase } from './client.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '..', '..', '..', 'drizzle');

export function runMigrations(db: AppDatabase): void {
  migrate(db, { migrationsFolder });
}
