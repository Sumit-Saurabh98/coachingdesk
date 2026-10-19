import { type WhatsAppSender, WhatsAppSendError } from '@coachingdesk/providers';
import type { Clock } from '@coachingdesk/shared';
import { DEFAULT_QUIET_HOURS, quietHoursEnd } from './quiet-hours';
import type { ConsentRepository } from './consent.repository';
import type { MessageCategory, OutboxMessage, OutboxRepository } from './outbox.repository';

/**
 * "Is this message still true right now, and what exactly does it say?" One per category
 * (LLD §6.3 revalidate table). Content is decided at SEND time: a fee reminder that waited
 * through the night shows what is due in the morning, not what was due when it was planned.
 */
export type Revalidation =
  | { kind: 'send'; template?: string; params?: Record<string, string> }
  | { kind: 'skip'; reason: 'stale' | 'nothing_due' };

export interface Revalidator {
  check(message: OutboxMessage): Promise<Revalidation>;
}

export interface DispatcherInstituteLookup {
  get(instituteId: string): Promise<{ timezone: string; isPendingDeletion: boolean }>;
}

/** MessageQuota fits: the plan quota and daily/trial caps (FR-5.6, FR-5.9). */
export interface SendQuota {
  tryConsume(instituteId: string, timezone: string): Promise<boolean>;
  release(instituteId: string, timezone: string): Promise<void>;
}

export interface OutboxDispatcherDeps {
  outbox: OutboxRepository;
  consents: ConsentRepository;
  sender: WhatsAppSender;
  institutes: DispatcherInstituteLookup;
  revalidators: Partial<Record<MessageCategory, Revalidator>>;
  quota: SendQuota;
  clock: Clock;
}

export interface DispatcherOptions {
  batchSize: number;
  maxAttempts: number; // total tries before 'failed' (LLD: retry ≤ 3)
  retryBaseMs: number; // 1st retry after this, then doubling
  stuckAfterMs: number; // 'sending' longer than this = the worker crashed mid-send
  quietHours: { start: string; end: string }; // FR-5.3: 21:00-08:00, institute time
}

export const DEFAULT_DISPATCHER_OPTIONS: DispatcherOptions = {
  batchSize: 50,
  maxAttempts: 3,
  retryBaseMs: 60_000,
  stuckAfterMs: 5 * 60_000,
  quietHours: DEFAULT_QUIET_HOURS,
};

interface InstituteInfo {
  timezone: string;
  isPendingDeletion: boolean;
}

export interface DispatchSummary {
  released: number;
  claimed: number;
  sent: number;
  skipped: number;
  rescheduled: number;
  failed: number;
}

/**
 * The send side of the outbox (LLD §6.3), run by the worker. Every check happens at SEND time,
 * against current data: consent may have changed, the student may have been marked present,
 * the night may have started. Several workers can run this at once (claims use SKIP LOCKED).
 */
export class OutboxDispatcher {
  private readonly options: DispatcherOptions;

  constructor(
    private readonly deps: OutboxDispatcherDeps,
    options: Partial<DispatcherOptions> = {},
  ) {
    this.options = { ...DEFAULT_DISPATCHER_OPTIONS, ...options };
  }

  async runOnce(): Promise<DispatchSummary> {
    const now = this.deps.clock.now();
    const summary: DispatchSummary = {
      released: await this.deps.outbox.releaseStuck(
        new Date(now.getTime() - this.options.stuckAfterMs),
      ),
      claimed: 0,
      sent: 0,
      skipped: 0,
      rescheduled: 0,
      failed: 0,
    };
    const messages = await this.deps.outbox.claimDue(now, this.options.batchSize);
    summary.claimed = messages.length;
    const institutes = new Map<string, InstituteInfo>(); // one lookup per institute per run

    for (const message of messages) {
      try {
        const result = await this.dispatch(message, now, institutes);
        summary[result] += 1;
      } catch (error) {
        // A bug or outage while handling ONE message must not stop the others: retry it later.
        summary[await this.retryOrFail(message, now, error)] += 1;
      }
    }
    return summary;
  }

  private async dispatch(
    message: OutboxMessage,
    now: Date,
    institutes: Map<string, InstituteInfo>,
  ): Promise<'sent' | 'skipped' | 'rescheduled' | 'failed'> {
    const { outbox, consents } = this.deps;

    if (message.expiresAt && now >= message.expiresAt) {
      await outbox.markSkipped(message.id, 'expired');
      return 'skipped';
    }
    // FR-7.7: a deletion request stops all messaging at once (even what was already queued).
    if ((await this.instituteOf(message.instituteId, institutes)).isPendingDeletion) {
      await outbox.markSkipped(message.id, 'institute_paused');
      return 'skipped';
    }
    // Global STOP covers every institute; receipts are the one exception (FR-5.7).
    if (message.category !== 'receipt' && (await consents.isGloballyOptedOut(message.to))) {
      await outbox.markSkipped(message.id, 'opted_out');
      return 'skipped';
    }
    const consent = await consents.consentOf(message.instituteId, message.to);
    if (consent !== 'opted_in') {
      await outbox.markSkipped(message.id, consent === 'opted_out' ? 'opted_out' : 'no_consent');
      return 'skipped';
    }

    const { timezone } = await this.instituteOf(message.instituteId, institutes);
    const quietUntil = quietHoursEnd(this.deps.clock, timezone, this.options.quietHours);
    if (quietUntil) {
      await outbox.reschedule(message.id, quietUntil, { kind: 'quiet_hours' });
      return 'rescheduled';
    }

    const revalidator = this.deps.revalidators[message.category];
    const content: Revalidation = revalidator ? await revalidator.check(message) : { kind: 'send' };
    if (content.kind === 'skip') {
      await outbox.markSkipped(message.id, content.reason);
      return 'skipped';
    }

    // Last check before spending: the institute's message limits. Atomic across workers.
    if (!(await this.deps.quota.tryConsume(message.instituteId, timezone))) {
      await outbox.markSkipped(message.id, 'over_quota');
      return 'skipped';
    }
    try {
      const { providerMessageId } = await this.deps.sender.sendTemplate({
        to: message.to,
        template: content.template ?? message.template,
        locale: message.locale,
        params: content.params ?? message.params,
      });
      await outbox.markSent(message.id, providerMessageId);
      return 'sent';
    } catch (error) {
      // Not delivered, not charged: the unit goes back to the quota.
      await this.deps.quota.release(message.instituteId, timezone);
      return this.retryOrFail(message, now, error);
    }
  }

  private async retryOrFail(
    message: OutboxMessage,
    now: Date,
    error: unknown,
  ): Promise<'rescheduled' | 'failed'> {
    const code = error instanceof WhatsAppSendError ? error.code : 'INTERNAL';
    const text = error instanceof Error ? error.message : String(error);
    // Unknown errors (our bug, a network blip) count as retryable; the provider says otherwise.
    const retryable = error instanceof WhatsAppSendError ? error.retryable : true;
    const attemptsSoFar = message.attempts + 1;
    if (!retryable || attemptsSoFar >= this.options.maxAttempts) {
      await this.deps.outbox.markFailed(message.id, { code, message: text });
      return 'failed';
    }
    // Exponential backoff: 1 min, 2 min, 4 min...
    const delay = this.options.retryBaseMs * 2 ** message.attempts;
    await this.deps.outbox.reschedule(message.id, new Date(now.getTime() + delay), {
      kind: 'retry',
      code,
      message: text,
    });
    return 'rescheduled';
  }

  private async instituteOf(
    instituteId: string,
    cache: Map<string, InstituteInfo>,
  ): Promise<InstituteInfo> {
    const cached = cache.get(instituteId);
    if (cached) {
      return cached;
    }
    const { timezone, isPendingDeletion } = await this.deps.institutes.get(instituteId);
    const info = { timezone, isPendingDeletion };
    cache.set(instituteId, info);
    return info;
  }
}
