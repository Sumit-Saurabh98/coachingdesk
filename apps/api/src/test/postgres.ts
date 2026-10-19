import { createDb, runMigrations, type Db } from '@coachingdesk/db';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';

/**
 * Starts a throwaway Postgres in Docker with all migrations applied: the same schema as
 * production. `reset()` empties every table between tests.
 */
export async function startTestDb(): Promise<{
  db: Db;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}> {
  const container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const { db, close } = createDb(container.getConnectionUri());
  await runMigrations(db);
  return {
    db,
    reset: async () => {
      await db.execute(
        sql`TRUNCATE users, refresh_tokens, institutes, memberships, subscriptions, batches, students, enrollments, attendance_sessions, attendance_records, guardian_contacts, whatsapp_opt_outs, message_outbox, invoice_counters, invoice_runs, invoices, payments, payment_allocations, message_usage, audit_log, notices CASCADE`,
      );
    },
    stop: async () => {
      await close();
      await container.stop();
    },
  };
}
