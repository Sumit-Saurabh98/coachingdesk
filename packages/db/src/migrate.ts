import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Db } from './index';

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies all pending migrations. Used by integration tests (and later by the deploy job). */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}
