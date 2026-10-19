import { describe, expect, it } from 'vitest';
import { FakeWhatsAppSender, WhatsAppSendError } from '@coachingdesk/providers';
import { FixedClock, PhoneNumber } from '@coachingdesk/shared';
import { absenceDedupeKey } from '../absence-messages';
import { AbsenceRevalidator } from '../absence-revalidator';
import { InMemoryConsentRepository } from '../consent.repository';
import { OutboxDispatcher } from '../outbox-dispatcher';
import { InMemoryOutboxRepository, type NewOutboxMessage } from '../outbox.repository';

const INSTITUTE = 'inst-1';
const guardian = PhoneNumber.parse('9812345678');
// 12:00 UTC = 17:30 IST: outside quiet hours.
const DAYTIME = '2026-10-19T12:00:00Z';

async function setup(
  options: {
    now?: string;
    consent?: boolean;
    status?: string;
    quota?: number;
    pendingDeletion?: boolean;
  } = {},
) {
  const clock = new FixedClock(new Date(options.now ?? DAYTIME));
  const outbox = new InMemoryOutboxRepository(() => clock.now());
  const consents = new InMemoryConsentRepository();
  if (options.consent ?? true) {
    await consents.setConsent(INSTITUTE, guardian, 'opted_in', 'add_student');
  }
  const sender = new FakeWhatsAppSender();
  let currentStatus: string | null = options.status ?? 'absent';
  let quotaLeft = options.quota ?? 1000;
  let released = 0;
  const dispatcher = new OutboxDispatcher(
    {
      outbox,
      consents,
      sender,
      institutes: {
        get: async () => ({
          timezone: 'Asia/Kolkata',
          isPendingDeletion: options.pendingDeletion ?? false,
        }),
      },
      revalidators: {
        absence: new AbsenceRevalidator({
          statusOf: async (_instituteId, _sessionId, studentId) => {
            if (studentId === 'student-broken') {
              throw new Error('database hiccup');
            }
            return currentStatus as 'absent' | null;
          },
        }),
      },
      quota: {
        tryConsume: async () => {
          if (quotaLeft <= 0) return false;
          quotaLeft -= 1;
          return true;
        },
        release: async () => {
          quotaLeft += 1;
          released += 1;
        },
      },
      clock,
    },
    { retryBaseMs: 60_000 },
  );
  let n = 0;
  const enqueue = async (overrides: Partial<NewOutboxMessage> = {}) => {
    n += 1;
    const message: NewOutboxMessage = {
      id: `msg-${n}`,
      instituteId: INSTITUTE,
      to: guardian,
      template: 'absence_alert',
      params: { student: 'Aarav' },
      locale: 'en',
      category: 'absence',
      priority: 2,
      scheduledFor: new Date('2026-10-19T11:00:00Z'),
      expiresAt: new Date('2026-10-20T04:30:00Z'),
      dedupeKey: absenceDedupeKey('session-1', `student-${n}`),
      related: null,
      ...overrides,
    };
    await outbox.enqueueAll([message]);
    return message;
  };
  const statusOf = async (m: NewOutboxMessage) => (await outbox.findByDedupeKey(m.dedupeKey))!;
  return {
    dispatcher,
    outbox,
    consents,
    sender,
    clock,
    enqueue,
    statusOf,
    setStatus: (s: string | null) => (currentStatus = s),
    quotaLeft: () => quotaLeft,
    released: () => released,
  };
}

describe('OutboxDispatcher.runOnce', () => {
  it('institute pending deletion: every message is skipped (institute_paused), nothing sent', async () => {
    const { dispatcher, sender, enqueue, statusOf, quotaLeft } = await setup({
      pendingDeletion: true,
    });
    const message = await enqueue();

    expect(await dispatcher.runOnce()).toMatchObject({ claimed: 1, skipped: 1, sent: 0 });

    expect(sender.sent).toEqual([]);
    expect(await statusOf(message)).toMatchObject({
      status: 'skipped',
      skipReason: 'institute_paused',
    });
    expect(quotaLeft()).toBe(1000);
  });

  it('sends a due, consented, still-true message', async () => {
    const { dispatcher, sender, enqueue, statusOf } = await setup();
    const message = await enqueue();

    const summary = await dispatcher.runOnce();

    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      template: 'absence_alert',
      params: { student: 'Aarav' },
    });
    expect(await statusOf(message)).toMatchObject({
      status: 'sent',
      providerMessageId: 'fake-wamid-1',
    });
  });

  it('no consent -> skipped (no_consent); opted out -> skipped (opted_out)', async () => {
    const noConsent = await setup({ consent: false });
    const m1 = await noConsent.enqueue();
    await noConsent.dispatcher.runOnce();
    expect(await noConsent.statusOf(m1)).toMatchObject({
      status: 'skipped',
      skipReason: 'no_consent',
    });

    const optedOut = await setup();
    await optedOut.consents.setConsent(INSTITUTE, guardian, 'opted_out', 'verbal');
    const m2 = await optedOut.enqueue();
    await optedOut.dispatcher.runOnce();
    expect(await optedOut.statusOf(m2)).toMatchObject({
      status: 'skipped',
      skipReason: 'opted_out',
    });
    expect(optedOut.sender.sent).toEqual([]);
  });

  it('global STOP blocks everything except receipts', async () => {
    const { dispatcher, consents, sender, enqueue, statusOf } = await setup();
    await consents.optOutGlobally(guardian, 'stop_reply', new Date());
    const absence = await enqueue();
    const receipt = await enqueue({
      category: 'receipt',
      priority: 1,
      template: 'payment_receipt',
    });

    await dispatcher.runOnce();

    expect(await statusOf(absence)).toMatchObject({ status: 'skipped', skipReason: 'opted_out' });
    expect(await statusOf(receipt)).toMatchObject({ status: 'sent' });
    expect(sender.sent.map((m) => m.template)).toEqual(['payment_receipt']);
  });

  it('expired -> skipped (a stale "absent" message would confuse parents)', async () => {
    const { dispatcher, enqueue, statusOf, sender } = await setup({ now: '2026-10-20T04:30:00Z' });
    const message = await enqueue();
    await dispatcher.runOnce();
    expect(await statusOf(message)).toMatchObject({ status: 'skipped', skipReason: 'expired' });
    expect(sender.sent).toEqual([]);
  });

  it('marked present meanwhile -> skipped (stale)', async () => {
    const { dispatcher, enqueue, statusOf, setStatus } = await setup();
    const message = await enqueue();
    setStatus('present');
    await dispatcher.runOnce();
    expect(await statusOf(message)).toMatchObject({ status: 'skipped', skipReason: 'stale' });
  });

  it.each([
    ['22:30 IST (before midnight)', '2026-10-19T17:00:00Z', '2026-10-20T02:30:00.000Z'],
    ['02:00 IST (after midnight)', '2026-10-19T20:30:00Z', '2026-10-20T02:30:00.000Z'],
  ])('quiet hours at %s -> rescheduled to 08:00 IST', async (_label, now, expected) => {
    const { dispatcher, enqueue, statusOf, sender } = await setup({ now });
    const message = await enqueue({ expiresAt: null });

    const summary = await dispatcher.runOnce();

    expect(summary.rescheduled).toBe(1);
    const stored = await statusOf(message);
    expect(stored.status).toBe('scheduled');
    expect(stored.scheduledFor.toISOString()).toBe(expected);
    expect(stored.attempts).toBe(0); // waiting is not a failed attempt
    expect(sender.sent).toEqual([]);
  });

  it('retryable error: back off and retry; after 3 attempts -> failed', async () => {
    const { dispatcher, sender, clock, enqueue, statusOf } = await setup();
    const message = await enqueue();
    sender.failNext(
      new WhatsAppSendError('timeout', true, 'TIMEOUT'),
      new WhatsAppSendError('timeout', true, 'TIMEOUT'),
      new WhatsAppSendError('timeout', true, 'TIMEOUT'),
    );

    await dispatcher.runOnce();
    expect(await statusOf(message)).toMatchObject({ status: 'queued', attempts: 1 });
    expect((await dispatcher.runOnce()).claimed).toBe(0); // not due yet: 1 min backoff

    clock.advanceMinutes(1);
    await dispatcher.runOnce();
    expect(await statusOf(message)).toMatchObject({ status: 'queued', attempts: 2 });

    clock.advanceMinutes(2); // the backoff doubled
    await dispatcher.runOnce();
    expect(await statusOf(message)).toMatchObject({ status: 'failed', errorCode: 'TIMEOUT' });
  });

  it('permanent error -> failed at once', async () => {
    const { dispatcher, sender, enqueue, statusOf } = await setup();
    const message = await enqueue();
    sender.failNext(new WhatsAppSendError('invalid number', false, 'INVALID_NUMBER'));
    await dispatcher.runOnce();
    expect(await statusOf(message)).toMatchObject({
      status: 'failed',
      errorCode: 'INVALID_NUMBER',
    });
  });

  it('one broken message does not stop the batch', async () => {
    const { dispatcher, enqueue, statusOf } = await setup();
    const broken = await enqueue({ dedupeKey: absenceDedupeKey('session-1', 'student-broken') });
    const fine = await enqueue();

    const summary = await dispatcher.runOnce();

    expect(summary).toMatchObject({ claimed: 2, sent: 1, rescheduled: 1 });
    expect(await statusOf(fine)).toMatchObject({ status: 'sent' });
    expect(await statusOf(broken)).toMatchObject({ status: 'queued', errorCode: 'INTERNAL' });
  });

  it('releases messages stuck in "sending" (a worker crashed mid-send)', async () => {
    const { dispatcher, outbox, clock, enqueue, statusOf } = await setup();
    const message = await enqueue();
    await outbox.claimDue(clock.now(), 10); // claimed by a worker that then died
    clock.advanceMinutes(6);

    const summary = await dispatcher.runOnce();

    expect(summary).toMatchObject({ released: 1, sent: 1 });
    expect(await statusOf(message)).toMatchObject({ status: 'sent' });
  });

  it('over the quota -> skipped (over_quota), nothing sent', async () => {
    const { dispatcher, sender, enqueue, statusOf } = await setup({ quota: 1 });
    const first = await enqueue();
    const second = await enqueue();

    await dispatcher.runOnce();

    expect(await statusOf(first)).toMatchObject({ status: 'sent' });
    expect(await statusOf(second)).toMatchObject({ status: 'skipped', skipReason: 'over_quota' });
    expect(sender.sent).toHaveLength(1);
  });

  it('a failed send gives its quota unit back', async () => {
    const { dispatcher, sender, enqueue, quotaLeft, released } = await setup({ quota: 5 });
    await enqueue();
    sender.failNext(new WhatsAppSendError('timeout', true, 'TIMEOUT'));

    await dispatcher.runOnce();

    expect(released()).toBe(1);
    expect(quotaLeft()).toBe(5);
  });
});
