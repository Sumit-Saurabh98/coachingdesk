import type { Db } from '@coachingdesk/db';
import { messageOutbox } from '@coachingdesk/db/schema';
import { PhoneNumber } from '@coachingdesk/shared';
import { and, desc, eq, inArray, like, lt, type SQL, sql } from 'drizzle-orm';
import {
  MESSAGE_CATEGORIES,
  MESSAGE_STATUSES,
  type MessageCategory,
  type MessageStatus,
  type NewOutboxMessage,
  type OutboxLogQuery,
  type OutboxMessage,
  type OutboxRepository,
  type SkipReason,
} from './outbox.repository';

type OutboxRow = typeof messageOutbox.$inferSelect;

export class DrizzleOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Db) {}

  async enqueueAll(messages: NewOutboxMessage[]): Promise<number> {
    if (messages.length === 0) {
      return 0;
    }
    // ON CONFLICT (dedupe_key) DO NOTHING: queuing the same message twice is a no-op, even when
    // two requests race. RETURNING tells us how many were genuinely new.
    const inserted = await this.db
      .insert(messageOutbox)
      .values(
        messages.map((m) => ({
          id: m.id,
          instituteId: m.instituteId,
          toPhone: m.to.toE164(),
          template: m.template,
          params: m.params,
          locale: m.locale,
          category: m.category,
          priority: m.priority,
          scheduledFor: m.scheduledFor,
          expiresAt: m.expiresAt,
          dedupeKey: m.dedupeKey,
          relatedType: m.related?.type ?? null,
          relatedId: m.related?.id ?? null,
        })),
      )
      .onConflictDoNothing({ target: messageOutbox.dedupeKey })
      .returning({ id: messageOutbox.id });
    return inserted.length;
  }

  async claimDue(now: Date, limit: number): Promise<OutboxMessage[]> {
    // FOR UPDATE SKIP LOCKED: rows another worker is claiming right now are SKIPPED, not
    // waited for. Several workers can poll at once and never send the same message twice.
    const rows = await this.db.execute<OutboxRow>(sql`
      update ${messageOutbox}
      set status = 'sending', updated_at = now()
      where id in (
        select id from ${messageOutbox}
        where status in ('queued', 'scheduled') and scheduled_for <= ${now.toISOString()}::timestamptz
        order by priority, scheduled_for
        limit ${limit}
        for update skip locked
      )
      returning *
    `);
    // RETURNING has no guaranteed order: sort in code (most important first).
    return rows
      .map(fromRawRow)
      .sort(
        (a, b) => a.priority - b.priority || a.scheduledFor.getTime() - b.scheduledFor.getTime(),
      );
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    await this.set(id, { status: 'sent', providerMessageId, errorCode: null, errorMessage: null });
  }

  async markSkipped(id: string, reason: SkipReason): Promise<void> {
    await this.set(id, { status: 'skipped', skipReason: reason });
  }

  async markFailed(id: string, error: { code: string; message: string }): Promise<void> {
    await this.set(id, { status: 'failed', errorCode: error.code, errorMessage: error.message });
  }

  async reschedule(
    id: string,
    at: Date,
    reason: { kind: 'quiet_hours' } | { kind: 'retry'; code: string; message: string },
  ): Promise<void> {
    if (reason.kind === 'quiet_hours') {
      await this.set(id, { status: 'scheduled', scheduledFor: at });
      return;
    }
    await this.db
      .update(messageOutbox)
      .set({
        status: 'queued',
        scheduledFor: at,
        attempts: sql`${messageOutbox.attempts} + 1`, // atomic increment in SQL, not read-then-write
        errorCode: reason.code,
        errorMessage: reason.message,
        updatedAt: sql`now()`,
      })
      .where(eq(messageOutbox.id, id));
  }

  async releaseStuck(before: Date): Promise<number> {
    const released = await this.db
      .update(messageOutbox)
      .set({ status: 'queued', updatedAt: sql`now()` })
      .where(and(eq(messageOutbox.status, 'sending'), lt(messageOutbox.updatedAt, before)))
      .returning({ id: messageOutbox.id });
    return released.length;
  }

  async findByDedupeKey(dedupeKey: string): Promise<OutboxMessage | null> {
    const [row] = await this.db
      .select()
      .from(messageOutbox)
      .where(eq(messageOutbox.dedupeKey, dedupeKey));
    return row ? toMessage(row) : null;
  }

  async forgetStudent(instituteId: string, studentId: string): Promise<number> {
    const queuedOrScheduled = sql`${messageOutbox.status} in ('queued', 'scheduled')`;
    const touched = await this.db
      .update(messageOutbox)
      .set({
        params: {},
        status: sql`case when ${queuedOrScheduled} then 'skipped' else ${messageOutbox.status} end`,
        skipReason: sql`case when ${queuedOrScheduled} then 'stale' else ${messageOutbox.skipReason} end`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(messageOutbox.instituteId, instituteId),
          like(messageOutbox.dedupeKey, `absence:%:${studentId}`),
        ),
      )
      .returning({ id: messageOutbox.id });
    return touched.length;
  }

  async forgetPhone(instituteId: string, phone: PhoneNumber): Promise<number> {
    const removed = await this.db
      .delete(messageOutbox)
      .where(
        and(eq(messageOutbox.instituteId, instituteId), eq(messageOutbox.toPhone, phone.toE164())),
      )
      .returning({ id: messageOutbox.id });
    return removed.length;
  }

  async listForInstitute(instituteId: string, query: OutboxLogQuery): Promise<OutboxMessage[]> {
    const conditions: SQL[] = [eq(messageOutbox.instituteId, instituteId)];
    if (query.status) conditions.push(eq(messageOutbox.status, query.status));
    if (query.category) conditions.push(eq(messageOutbox.category, query.category));
    if (query.beforeId) conditions.push(lt(messageOutbox.id, query.beforeId));
    const rows = await this.db
      .select()
      .from(messageOutbox)
      .where(and(...conditions))
      .orderBy(desc(messageOutbox.id))
      .limit(query.limit);
    return rows.map(toMessage);
  }

  private async set(
    id: string,
    changes: Partial<typeof messageOutbox.$inferInsert>,
  ): Promise<void> {
    const updated = await this.db
      .update(messageOutbox)
      .set({ ...changes, updatedAt: sql`now()` })
      .where(inArray(messageOutbox.id, [id]))
      .returning({ id: messageOutbox.id });
    if (updated.length === 0) {
      throw new Error(`DrizzleOutboxRepository: no message ${id}`);
    }
  }
}

/** A row from db.execute() has snake_case keys and raw values: convert it first. */
function fromRawRow(raw: Record<string, unknown>): OutboxMessage {
  const date = (v: unknown) => (v === null ? null : new Date(v as string));
  return toMessage({
    id: raw.id as string,
    instituteId: raw.institute_id as string,
    toPhone: raw.to_phone as string,
    channel: raw.channel as string,
    template: raw.template as string,
    params: raw.params as Record<string, string>,
    locale: raw.locale as string,
    category: raw.category as string,
    status: raw.status as string,
    scheduledFor: date(raw.scheduled_for) as Date,
    attempts: Number(raw.attempts),
    providerMessageId: (raw.provider_message_id as string | null) ?? null,
    errorCode: (raw.error_code as string | null) ?? null,
    errorMessage: (raw.error_message as string | null) ?? null,
    skipReason: (raw.skip_reason as string | null) ?? null,
    priority: Number(raw.priority),
    expiresAt: date(raw.expires_at),
    dedupeKey: raw.dedupe_key as string,
    relatedType: (raw.related_type as string | null) ?? null,
    relatedId: (raw.related_id as string | null) ?? null,
    createdAt: date(raw.created_at) as Date,
    updatedAt: date(raw.updated_at) as Date,
  });
}

function toMessage(row: OutboxRow): OutboxMessage {
  return {
    id: row.id,
    instituteId: row.instituteId,
    to: PhoneNumber.parse(row.toPhone),
    template: row.template,
    params: row.params,
    locale: row.locale === 'hi' ? 'hi' : 'en',
    category: oneOf(MESSAGE_CATEGORIES, row.category) as MessageCategory,
    priority: row.priority as 1 | 2 | 3 | 4,
    scheduledFor: row.scheduledFor,
    expiresAt: row.expiresAt,
    dedupeKey: row.dedupeKey,
    createdAt: row.createdAt,
    related: row.relatedType && row.relatedId ? { type: row.relatedType, id: row.relatedId } : null,
    status: oneOf(MESSAGE_STATUSES, row.status) as MessageStatus,
    attempts: row.attempts,
    providerMessageId: row.providerMessageId,
    skipReason: row.skipReason as SkipReason | null,
    errorCode: row.errorCode,
  };
}

function oneOf<T extends string>(allowed: readonly T[], value: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Unexpected value in message_outbox: ${value}`);
}
