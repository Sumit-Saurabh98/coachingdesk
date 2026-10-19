import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { institutes } from './institutes';

/**
 * Has this guardian agreed to receive WhatsApp updates FROM THIS INSTITUTE? (KB "Messaging":
 * institutes confirm consent when adding students). Only 'opted_in' is ever sent (LLD §6.3).
 */
export const guardianContacts = pgTable(
  'guardian_contacts',
  {
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    phone: text().notNull(), // E.164
    optInStatus: text().notNull().default('unknown'),
    optInSource: text(), // 'add_student' | 'verbal' | 'form' | 'whatsapp'
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    primaryKey({ columns: [t.instituteId, t.phone] }),
    check(
      'guardian_contacts_opt_in_status_check',
      sql`${t.optInStatus} in ('unknown', 'opted_in', 'opted_out')`,
    ),
  ],
);

/**
 * GLOBAL opt-outs (not per institute): every institute sends from our one WhatsApp number, so
 * "STOP" stops automatic messages from all of them (FR-5.7). Receipts are the only exception.
 */
export const whatsappOptOuts = pgTable('whatsapp_opt_outs', {
  phone: text().primaryKey(),
  optedOutAt: timestamp({ withTimezone: true }).notNull(),
  source: text().notNull(), // 'stop_reply' | 'support'
});

/**
 * The transactional outbox (AGENTS rule 4): API code never calls a provider. It inserts a row
 * here; the worker sends it. dedupe_key makes "queue this message" safe to repeat.
 */
export const messageOutbox = pgTable(
  'message_outbox',
  {
    id: uuid().primaryKey(),
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    toPhone: text().notNull(),
    channel: text().notNull().default('whatsapp'),
    template: text().notNull(),
    // Template parameters. NEVER raw public tokens: links are minted at send time (LLD §6.3).
    params: jsonb().$type<Record<string, string>>().notNull(),
    locale: text().notNull().default('en'),
    category: text().notNull(),
    status: text().notNull().default('queued'),
    scheduledFor: timestamp({ withTimezone: true }).notNull(),
    attempts: integer().notNull().default(0),
    providerMessageId: text().unique('message_outbox_provider_message_id_unique'),
    errorCode: text(),
    errorMessage: text(),
    skipReason: text(),
    // 1 receipt · 2 absence · 3 fee_reminder/result · 4 notice (lower = sent first)
    priority: smallint().notNull(),
    expiresAt: timestamp({ withTimezone: true }), // don't send after this
    dedupeKey: text().notNull().unique('message_outbox_dedupe_key_unique'),
    relatedType: text(),
    relatedId: uuid(),
    ...timestamps,
  },
  (t) => [
    // The worker's query: "due messages, most important first".
    index('message_outbox_due_idx').on(t.status, t.priority, t.scheduledFor),
    index('message_outbox_institute_created_idx').on(t.instituteId, t.createdAt),
    check('message_outbox_channel_check', sql`${t.channel} in ('whatsapp', 'sms')`),
    check('message_outbox_locale_check', sql`${t.locale} in ('en', 'hi')`),
    check(
      'message_outbox_category_check',
      sql`${t.category} in ('fee_reminder', 'receipt', 'absence', 'result', 'notice', 'otp')`,
    ),
    check(
      'message_outbox_status_check',
      sql`${t.status} in ('queued', 'scheduled', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')`,
    ),
    check('message_outbox_priority_check', sql`${t.priority} between 1 and 4`),
    check('message_outbox_attempts_check', sql`${t.attempts} >= 0`),
  ],
);

/**
 * Automatic messages SENT per institute per (institute-local) day. Enforces the plan's monthly
 * quota (sum of the month's days), the new-institute/trial daily cap, and the trial total
 * (FR-5.6, FR-5.9; LLD §6.8). One small table instead of two: the month and trial totals are sums.
 */
export const messageUsage = pgTable(
  'message_usage',
  {
    instituteId: uuid()
      .notNull()
      .references(() => institutes.id),
    day: date({ mode: 'string' }).notNull(),
    sent: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.instituteId, t.day] }),
    check('message_usage_sent_check', sql`${t.sent} >= 0`),
  ],
);
