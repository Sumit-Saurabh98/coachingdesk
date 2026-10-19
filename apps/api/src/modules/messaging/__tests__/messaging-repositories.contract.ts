import { describe, expect, it } from 'vitest';
import { PhoneNumber } from '@coachingdesk/shared';
import type { ConsentRepository } from '../consent.repository';
import type { NewOutboxMessage, OutboxRepository } from '../outbox.repository';

/** Institutes that must exist first (Postgres FK). */
export const CONTRACT = {
  instituteA: '00000000-0000-7000-8000-0000000040a1',
  instituteB: '00000000-0000-7000-8000-0000000040b1',
} as const;

const phone = PhoneNumber.parse('9876543210');
const t = (minute: number) => new Date(Date.UTC(2026, 9, 19, 10, minute));
let n = 0;

export const message = (overrides: Partial<NewOutboxMessage> = {}): NewOutboxMessage => {
  n += 1;
  return {
    id: `00000000-0000-7000-8000-0000000041${String(n % 100).padStart(2, '0')}`,
    instituteId: CONTRACT.instituteA,
    to: phone,
    template: 'absence_alert',
    params: { student: 'Aarav' },
    locale: 'en',
    category: 'absence',
    priority: 2,
    scheduledFor: t(0),
    expiresAt: null,
    dedupeKey: `absence:test:${n}`,
    related: null,
    ...overrides,
  };
};

export function describeOutboxRepositoryContract(
  name: string,
  create: () => OutboxRepository,
): void {
  describe(`OutboxRepository contract: ${name}`, () => {
    it('queues a message; the same dedupe key again is ignored', async () => {
      const repo = create();
      const first = message({ dedupeKey: 'absence:s1:st1' });

      expect(await repo.enqueueAll([first])).toBe(1);
      expect(await repo.enqueueAll([message({ dedupeKey: 'absence:s1:st1' })])).toBe(0);

      expect(await repo.findByDedupeKey('absence:s1:st1')).toMatchObject({
        id: first.id,
        status: 'queued',
        attempts: 0,
        params: { student: 'Aarav' },
      });
    });

    it('claims due messages, most important first, and not twice', async () => {
      const repo = create();
      const notice = message({ priority: 4, scheduledFor: t(0) });
      const absence = message({ priority: 2, scheduledFor: t(5) });
      const later = message({ priority: 1, scheduledFor: t(30) }); // not due yet
      await repo.enqueueAll([notice, absence, later]);

      const claimed = await repo.claimDue(t(10), 10);

      expect(claimed.map((m) => m.id)).toEqual([absence.id, notice.id]);
      expect(claimed.every((m) => m.status === 'sending')).toBe(true);
      expect(await repo.claimDue(t(10), 10)).toEqual([]);
    });

    it('respects the limit', async () => {
      const repo = create();
      await repo.enqueueAll([message(), message(), message()]);
      expect(await repo.claimDue(t(10), 2)).toHaveLength(2);
    });

    it('records sent / skipped / failed', async () => {
      const repo = create();
      const [a, b, c] = [message(), message(), message()];
      await repo.enqueueAll([a, b, c]);
      await repo.claimDue(t(10), 10);

      await repo.markSent(a.id, 'wamid-1');
      await repo.markSkipped(b.id, 'no_consent');
      await repo.markFailed(c.id, { code: 'INVALID_NUMBER', message: 'bad number' });

      expect(await repo.findByDedupeKey(a.dedupeKey)).toMatchObject({
        status: 'sent',
        providerMessageId: 'wamid-1',
      });
      expect(await repo.findByDedupeKey(b.dedupeKey)).toMatchObject({
        status: 'skipped',
        skipReason: 'no_consent',
      });
      expect(await repo.findByDedupeKey(c.dedupeKey)).toMatchObject({
        status: 'failed',
        errorCode: 'INVALID_NUMBER',
      });
    });

    it('the message log: newest first, filtered, paged by id; only this institute', async () => {
      const repo = create();
      const [a, b, c] = [message(), message({ category: 'fee_reminder' }), message()];
      await repo.enqueueAll([a, b, c]);
      await repo.enqueueAll([message({ instituteId: CONTRACT.instituteB })]);
      const ids = (list: { id: string }[]) => list.map((m) => m.id);

      expect(ids(await repo.listForInstitute(CONTRACT.instituteA, { limit: 10 }))).toEqual([
        c.id,
        b.id,
        a.id,
      ]);
      expect(
        ids(
          await repo.listForInstitute(CONTRACT.instituteA, { category: 'fee_reminder', limit: 10 }),
        ),
      ).toEqual([b.id]);
      expect(
        ids(await repo.listForInstitute(CONTRACT.instituteA, { limit: 2, beforeId: c.id })),
      ).toEqual([b.id, a.id]);
    });

    it("erasure: forgetStudent clears that student's absence alerts and result cards, cancels queued ones", async () => {
      const repo = create();
      const queued = message({
        dedupeKey: 'absence:sess-1:student-x',
        params: { student: 'Aarav' },
      });
      const sent = message({ dedupeKey: 'absence:sess-0:student-x', params: { student: 'Aarav' } });
      const other = message({
        dedupeKey: 'absence:sess-1:student-y',
        params: { student: 'Bhavya' },
      });
      const resultCard = message({
        dedupeKey: 'result:test-1:student-x',
        params: { student: 'Aarav', marks: '42' },
      });
      await repo.enqueueAll([queued, sent, other]);
      await repo.claimDue(t(10), 10);
      await repo.enqueueAll([resultCard]); // still queued
      await repo.markSent(sent.id, 'wamid-9');
      await repo.reschedule(queued.id, t(5), { kind: 'quiet_hours' });

      expect(await repo.forgetStudent(CONTRACT.instituteA, 'student-x')).toBe(3);

      expect(await repo.findByDedupeKey(resultCard.dedupeKey)).toMatchObject({
        params: {},
        status: 'skipped',
        skipReason: 'stale',
      });

      expect(await repo.findByDedupeKey(queued.dedupeKey)).toMatchObject({
        params: {},
        status: 'skipped',
        skipReason: 'stale',
      });
      expect(await repo.findByDedupeKey(sent.dedupeKey)).toMatchObject({
        params: {},
        status: 'sent',
      });
      expect((await repo.findByDedupeKey(other.dedupeKey))?.params).toEqual({ student: 'Bhavya' });
    });

    it('erasure: forgetPhone deletes the institute messages to that phone only', async () => {
      const repo = create();
      const mine = message();
      const otherPhone = message({ to: PhoneNumber.parse('9123456789') });
      const otherInstitute = message({ instituteId: CONTRACT.instituteB });
      await repo.enqueueAll([mine, otherPhone, otherInstitute]);

      expect(await repo.forgetPhone(CONTRACT.instituteA, phone)).toBe(1);

      expect(await repo.findByDedupeKey(mine.dedupeKey)).toBeNull();
      expect(await repo.findByDedupeKey(otherPhone.dedupeKey)).not.toBeNull();
      expect(await repo.findByDedupeKey(otherInstitute.dedupeKey)).not.toBeNull();
    });

    it('reschedule: quiet hours keep attempts; a retry counts one more attempt', async () => {
      const repo = create();
      const [a, b] = [message(), message()];
      await repo.enqueueAll([a, b]);
      await repo.claimDue(t(10), 10);

      await repo.reschedule(a.id, t(40), { kind: 'quiet_hours' });
      await repo.reschedule(b.id, t(20), { kind: 'retry', code: 'TIMEOUT', message: 'timeout' });

      expect(await repo.findByDedupeKey(a.dedupeKey)).toMatchObject({
        status: 'scheduled',
        attempts: 0,
        scheduledFor: t(40),
      });
      expect(await repo.findByDedupeKey(b.dedupeKey)).toMatchObject({
        status: 'queued',
        attempts: 1,
        errorCode: 'TIMEOUT',
      });
      expect((await repo.claimDue(t(25), 10)).map((m) => m.id)).toEqual([b.id]);
    });
  });
}

export function describeConsentRepositoryContract(
  name: string,
  create: () => ConsentRepository,
): void {
  describe(`ConsentRepository contract: ${name}`, () => {
    it("'unknown' until recorded; the latest decision wins; per institute", async () => {
      const repo = create();
      expect(await repo.consentOf(CONTRACT.instituteA, phone)).toBe('unknown');

      await repo.setConsent(CONTRACT.instituteA, phone, 'opted_in', 'add_student');
      expect(await repo.consentOf(CONTRACT.instituteA, phone)).toBe('opted_in');
      expect(await repo.consentOf(CONTRACT.instituteB, phone)).toBe('unknown');

      await repo.setConsent(CONTRACT.instituteA, phone, 'opted_out', 'verbal');
      expect(await repo.consentOf(CONTRACT.instituteA, phone)).toBe('opted_out');
    });

    it('forget removes the consent record (back to unknown)', async () => {
      const repo = create();
      await repo.setConsent(CONTRACT.instituteA, phone, 'opted_in', 'add_student');
      await repo.forget(CONTRACT.instituteA, phone);
      expect(await repo.consentOf(CONTRACT.instituteA, phone)).toBe('unknown');
    });

    it('a global opt-out applies to the phone everywhere (and is idempotent)', async () => {
      const repo = create();
      expect(await repo.isGloballyOptedOut(phone)).toBe(false);

      await repo.optOutGlobally(phone, 'stop_reply', t(0));
      await repo.optOutGlobally(phone, 'stop_reply', t(1));

      expect(await repo.isGloballyOptedOut(phone)).toBe(true);
      expect(await repo.isGloballyOptedOut(PhoneNumber.parse('9123456789'))).toBe(false);
    });
  });
}
