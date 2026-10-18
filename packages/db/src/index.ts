import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export { schema };

/** Creates the Drizzle client. Called once per app, in its composition root (container.ts). */
export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return { db, close: () => client.end() };
}

export type Db = ReturnType<typeof createDb>['db'];
