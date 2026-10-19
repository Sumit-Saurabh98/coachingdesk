import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { institutes } from './institutes';

/**
 * One row per institute: which plan it's on and where it is in its lifecycle (docs/LLD.md §3.3).
 *   trialing -> active (paid) | free (trial ended, unpaid)
 *   active -> past_due (renewal failed) -> active (paid) | free (grace ended)
 *   active -> cancelled (at period end) -> free
 * Prices and limits per plan are NOT stored here: they live in KNOWLEDGE_BASE §3 / plans.ts.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    // The institute's id IS the primary key: the database itself guarantees
    // "exactly one subscription per institute". No second row can ever exist.
    instituteId: uuid()
      .primaryKey()
      .references(() => institutes.id),
    plan: text().notNull(),
    status: text().notNull(),
    // null while trialing or on free: there's no billing interval yet
    interval: text(),
    // Payment provider details, filled once the institute pays (billing decision pending)
    provider: text(),
    providerSubId: text(),
    // trialing: when the trial ends · active: when the paid period ends
    currentPeriodEnd: timestamp({ withTimezone: true }),
    // past_due: until when the institute keeps its plan before falling back to free (7 days)
    graceUntil: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check('subscriptions_plan_check', sql`${t.plan} in ('free', 'starter', 'pro', 'academy')`),
    check(
      'subscriptions_status_check',
      sql`${t.status} in ('trialing', 'active', 'past_due', 'cancelled', 'free')`,
    ),
    check(
      'subscriptions_interval_check',
      sql`${t.interval} is null or ${t.interval} in ('month', 'year')`,
    ),
    // A trial or paid period always has an end date; this catches a whole class of bugs.
    check(
      'subscriptions_period_end_check',
      sql`${t.status} not in ('trialing', 'active', 'past_due') or ${t.currentPeriodEnd} is not null`,
    ),
  ],
);
