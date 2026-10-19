import { type WhatsAppSender, WhatsAppSendError } from '@coachingdesk/providers';
import { type Clock, InstituteClock, zonedInstant } from '@coachingdesk/shared';
import type { ConsentRepository } from './consent.repository';
import type { MessageCategory, OutboxMessage, OutboxRepository } from './outbox.repository';

/** "Is this message still true right now?" One per category (LLD §6.3 revalidate table). */
export interface Revalidator {
  check(message: OutboxMessage): Promise<'send' | 'stale'>;
}

export interface DispatcherInstituteLookup {
  get(instituteId: string): Promise<{ timezone: string }>;
}

export interface OutboxDispatcherDeps {
  outbox: OutboxRepository;
  consents: ConsentRepository;
  sender: WhatsAppSender;
  institutes: DispatcherInstituteLookup;
  revalidators: Partial<Record<MessageCategory, Revalidator>>;
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
  quietHours: { start: '21:00', end: '08:00' },
};

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
    const timezones = new Map<string, string>(); // one institute lookup per run, not per message

    for (const message of messages) {
      try {
        const result = await this.dispatch(message, now, timezones);
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
    timezones: Map<string, string>,
  ): Promise<'sent' | 'skipped' | 'rescheduled' | 'failed'> {
    const { outbox, consents } = this.deps;

    if (message.expiresAt && now >= message.expiresAt) {
      await outbox.markSkipped(message.id, 'expired');
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

    const timezone = await this.timezoneOf(message.instituteId, timezones);
    const quietUntil = this.quietHoursEnd(timezone);
    if (quietUntil) {
      await outbox.reschedule(message.id, quietUntil, { kind: 'quiet_hours' });
      return 'rescheduled';
    }

    const revalidator = this.deps.revalidators[message.category];
    if (revalidator && (await revalidator.check(message)) === 'stale') {
      await outbox.markSkipped(message.id, 'stale');
      return 'skipped';
    }

    try {
      const { providerMessageId } = await this.deps.sender.sendTemplate({
        to: message.to,
        template: message.template,
        locale: message.locale,
        params: message.params,
      });
      await outbox.markSent(message.id, providerMessageId);
      return 'sent';
    } catch (error) {
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

  /** null = not quiet now. Otherwise the instant quiet hours end (next 08:00 local). */
  private quietHoursEnd(timezone: string): Date | null {
    const local = new InstituteClock(this.deps.clock, timezone);
    const minutes = local.minutesSinceMidnight();
    const start = toMinutes(this.options.quietHours.start);
    const end = toMinutes(this.options.quietHours.end);
    const quiet =
      start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
    if (!quiet) {
      return null;
    }
    // Before midnight -> tomorrow's 08:00; after midnight -> today's 08:00.
    const today = local.today();
    const endDay = minutes >= start && start > end ? today.addDays(1) : today;
    return zonedInstant(endDay, this.options.quietHours.end, timezone);
  }

  private async timezoneOf(instituteId: string, cache: Map<string, string>): Promise<string> {
    const cached = cache.get(instituteId);
    if (cached) {
      return cached;
    }
    const { timezone } = await this.deps.institutes.get(instituteId);
    cache.set(instituteId, timezone);
    return timezone;
  }
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
