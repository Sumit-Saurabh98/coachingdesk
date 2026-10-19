import type { PhoneNumber } from '@coachingdesk/shared';

export const MESSAGE_CATEGORIES = [
  'fee_reminder',
  'receipt',
  'absence',
  'result',
  'notice',
  'otp',
] as const;
export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];

export const MESSAGE_STATUSES = [
  'queued',
  'scheduled',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'skipped',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export type SkipReason =
  | 'opted_out'
  | 'no_consent'
  | 'over_quota'
  | 'plan_disallows'
  | 'nothing_due'
  | 'stale'
  | 'expired'
  | 'institute_paused'
  | 'platform_limit';

export interface NewOutboxMessage {
  id: string;
  instituteId: string;
  to: PhoneNumber;
  template: string;
  params: Record<string, string>;
  locale: 'en' | 'hi';
  category: MessageCategory;
  priority: 1 | 2 | 3 | 4; // 1 receipt · 2 absence · 3 fee_reminder/result · 4 notice
  scheduledFor: Date;
  expiresAt: Date | null;
  dedupeKey: string;
  related: { type: string; id: string } | null;
}

export interface OutboxMessage extends NewOutboxMessage {
  createdAt: Date;
  status: MessageStatus;
  attempts: number;
  providerMessageId: string | null;
  skipReason: SkipReason | null;
  errorCode: string | null;
}

export interface OutboxLogQuery {
  status?: MessageStatus;
  category?: MessageCategory;
  limit: number;
  /**
   * Keyset paging: messages with an id below this one. Ids are UUIDv7 (time-ordered), so
   * "newest first" = id descending, exactly; no timestamp-precision games.
   */
  beforeId?: string;
}

export interface OutboxRepository {
  /** Queues messages; any whose dedupe_key already exists is silently ignored. Returns how many were NEW. */
  enqueueAll(messages: NewOutboxMessage[]): Promise<number>;
  /**
   * Atomically moves up to `limit` due messages (queued/scheduled, scheduled_for <= now) to
   * 'sending' and returns them, most important first. Two workers never get the same message.
   */
  claimDue(now: Date, limit: number): Promise<OutboxMessage[]>;
  markSent(id: string, providerMessageId: string): Promise<void>;
  markSkipped(id: string, reason: SkipReason): Promise<void>;
  markFailed(id: string, error: { code: string; message: string }): Promise<void>;
  /** Back to the queue for later: quiet hours ('scheduled'), or a retry after an error ('queued', attempts + 1). */
  reschedule(
    id: string,
    at: Date,
    reason: { kind: 'quiet_hours' } | { kind: 'retry'; code: string; message: string },
  ): Promise<void>;
  /** Crash recovery: 'sending' rows not touched since `before` go back to 'queued'. Returns how many. */
  releaseStuck(before: Date): Promise<number>;
  findByDedupeKey(dedupeKey: string): Promise<OutboxMessage | null>;
  /** The institute's message log, newest first. */
  listForInstitute(instituteId: string, query: OutboxLogQuery): Promise<OutboxMessage[]>;
}

/** Tests and local dev only. */
export class InMemoryOutboxRepository implements OutboxRepository {
  private readonly rows = new Map<string, OutboxMessage & { touchedAt: Date }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async enqueueAll(messages: NewOutboxMessage[]): Promise<number> {
    let added = 0;
    for (const message of messages) {
      if ([...this.rows.values()].some((r) => r.dedupeKey === message.dedupeKey)) {
        continue;
      }
      this.rows.set(message.id, {
        ...message,
        status: 'queued',
        attempts: 0,
        providerMessageId: null,
        skipReason: null,
        errorCode: null,
        createdAt: this.now(),
        touchedAt: this.now(),
      });
      added += 1;
    }
    return added;
  }

  async claimDue(now: Date, limit: number): Promise<OutboxMessage[]> {
    const due = [...this.rows.values()]
      .filter((r) => (r.status === 'queued' || r.status === 'scheduled') && r.scheduledFor <= now)
      .sort(byPriorityThenTime)
      .slice(0, limit);
    for (const row of due) {
      row.status = 'sending';
      row.touchedAt = this.now();
    }
    return due.map(strip);
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    this.update(id, { status: 'sent', providerMessageId });
  }

  async markSkipped(id: string, reason: SkipReason): Promise<void> {
    this.update(id, { status: 'skipped', skipReason: reason });
  }

  async markFailed(id: string, error: { code: string; message: string }): Promise<void> {
    this.update(id, { status: 'failed', errorCode: error.code });
  }

  async reschedule(
    id: string,
    at: Date,
    reason: { kind: 'quiet_hours' } | { kind: 'retry'; code: string; message: string },
  ): Promise<void> {
    const row = this.get(id);
    this.update(id, {
      status: reason.kind === 'quiet_hours' ? 'scheduled' : 'queued',
      scheduledFor: at,
      attempts: reason.kind === 'retry' ? row.attempts + 1 : row.attempts,
      errorCode: reason.kind === 'retry' ? reason.code : row.errorCode,
    });
  }

  async releaseStuck(before: Date): Promise<number> {
    let released = 0;
    for (const row of this.rows.values()) {
      if (row.status === 'sending' && row.touchedAt < before) {
        row.status = 'queued';
        row.touchedAt = this.now();
        released += 1;
      }
    }
    return released;
  }

  async findByDedupeKey(dedupeKey: string): Promise<OutboxMessage | null> {
    const row = [...this.rows.values()].find((r) => r.dedupeKey === dedupeKey);
    return row ? strip(row) : null;
  }

  async listForInstitute(instituteId: string, query: OutboxLogQuery): Promise<OutboxMessage[]> {
    return [...this.rows.values()]
      .filter((r) => r.instituteId === instituteId)
      .filter((r) => !query.status || r.status === query.status)
      .filter((r) => !query.category || r.category === query.category)
      .filter((r) => !query.beforeId || r.id < query.beforeId)
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, query.limit)
      .map(strip);
  }

  private get(id: string) {
    const row = this.rows.get(id);
    if (!row) {
      throw new Error(`InMemoryOutboxRepository: no message ${id}`);
    }
    return row;
  }

  private update(id: string, changes: Partial<OutboxMessage>): void {
    Object.assign(this.get(id), changes, { touchedAt: this.now() });
  }
}

function strip(row: OutboxMessage & { touchedAt: Date }): OutboxMessage {
  const { touchedAt: _touchedAt, ...message } = row;
  return { ...message, params: { ...message.params } };
}

function byPriorityThenTime(a: OutboxMessage, b: OutboxMessage): number {
  return a.priority - b.priority || a.scheduledFor.getTime() - b.scheduledFor.getTime();
}
