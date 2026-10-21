import { describe, expect, it } from 'vitest';
import {
  type FeatureKey,
  FixedClock,
  LocalDate,
  PhoneNumber,
  SequentialIdGenerator,
} from '@coachingdesk/shared';
import type { AttendanceRecord, AttendanceSession } from '../../attendance/attendance.repository';
import { absenceDedupeKey, parseAbsenceDedupeKey } from '../absence-messages';
import { expiryOf, OutboxAbsenceAlerts } from '../outbox-absence-alerts';
import { InMemoryOutboxRepository } from '../outbox.repository';

const session: AttendanceSession = {
  id: 'session-1',
  instituteId: 'inst-1',
  batchId: 'batch-1',
  date: LocalDate.parse('2026-10-19'),
  takenBy: 'teacher-1',
  submittedAt: new Date('2026-10-19T12:00:00Z'),
  alertsEnqueuedAt: null,
  clientId: 'client-1',
};
const mark = (studentId: string, status: AttendanceRecord['status']): AttendanceRecord => ({
  studentId,
  status,
  updatedBy: 'teacher-1',
  updatedAt: new Date(),
});

function setup(options: { features?: FeatureKey[]; absenceAlerts?: boolean; now?: string } = {}) {
  const outbox = new InMemoryOutboxRepository();
  const alerts = new OutboxAbsenceAlerts({
    outbox,
    institutes: {
      get: async () => ({
        name: 'Sharma Classes',
        timezone: 'Asia/Kolkata',
        settings: { absenceAlerts: options.absenceAlerts ?? true, messageLanguage: 'hi' },
      }),
    },
    entitlements: {
      get: async () => ({ features: new Set(options.features ?? ['automatic_messages']) }),
    },
    batches: { get: async () => ({ name: 'Class 10 Maths' }) },
    students: {
      findByIds: async (_instituteId, ids) =>
        ids.map((id) => ({
          id,
          name: id === 'erased' ? 'Erased student' : `Student ${id}`,
          guardianPhone: id === 'erased' ? null : PhoneNumber.parse('9876543210'),
          studentPhone: id === 'own' ? PhoneNumber.parse('9123456789') : null,
        })),
    },
    ids: new SequentialIdGenerator(),
    clock: new FixedClock(new Date(options.now ?? '2026-10-19T12:00:00Z')),
  });
  return { alerts, outbox };
}

describe('OutboxAbsenceAlerts', () => {
  it('a student with their own number: a copy goes there too, with its own key (KB #50)', async () => {
    const { alerts, outbox } = setup();
    const outcome = await alerts.afterSync({ session, records: [mark('own', 'absent')] });

    expect(outcome).toEqual({ status: 'queued', queued: 2 });
    const copy = await outbox.findByDedupeKey(absenceDedupeKey('session-1', 'own', 'student'));
    expect(copy?.to.toE164()).toBe('+919123456789');
    // The worker can still find the student behind the copy ("still absent?").
    expect(parseAbsenceDedupeKey(copy?.dedupeKey ?? '')).toEqual({
      sessionId: 'session-1',
      studentId: 'own',
    });
  });

  it('queues one absence_alert per absent student, with the template params', async () => {
    const { alerts, outbox } = setup();

    const outcome = await alerts.afterSync({
      session,
      records: [mark('a', 'absent'), mark('b', 'present'), mark('c', 'absent')],
    });

    expect(outcome).toEqual({ status: 'queued', queued: 2 });
    expect(await outbox.findByDedupeKey(absenceDedupeKey('session-1', 'a'))).toMatchObject({
      template: 'absence_alert',
      category: 'absence',
      priority: 2,
      locale: 'hi',
      params: {
        student: 'Student a',
        date: '19 Oct 2026',
        batch: 'Class 10 Maths',
        institute: 'Sharma Classes',
      },
      expiresAt: new Date('2026-10-20T04:30:00Z'), // 10:00 IST the next day
    });
    expect(await outbox.findByDedupeKey(absenceDedupeKey('session-1', 'b'))).toBeNull();
  });

  it('nobody absent: none_absent, nothing queued', async () => {
    const { alerts } = setup();
    expect(await alerts.afterSync({ session, records: [mark('a', 'late')] })).toEqual({
      status: 'none_absent',
      queued: 0,
    });
  });

  it('not_enabled: plan without automatic messages (Free), or the setting off', async () => {
    const records = [mark('a', 'absent')];
    expect((await setup({ features: [] }).alerts.afterSync({ session, records })).status).toBe(
      'not_enabled',
    );
    expect(
      (await setup({ absenceAlerts: false }).alerts.afterSync({ session, records })).status,
    ).toBe('not_enabled');
  });

  it('too_late: synced at/after 10:00 the next morning', async () => {
    const records = [mark('a', 'absent')];
    const justBefore = setup({ now: '2026-10-20T04:29:59Z' });
    const atExpiry = setup({ now: '2026-10-20T04:30:00Z' });
    expect((await justBefore.alerts.afterSync({ session, records })).status).toBe('queued');
    expect((await atExpiry.alerts.afterSync({ session, records })).status).toBe('too_late');
  });

  it('an erased student gets no message (no guardian phone)', async () => {
    const { alerts } = setup();
    expect(
      await alerts.afterSync({ session, records: [mark('erased', 'absent'), mark('a', 'absent')] }),
    ).toEqual({ status: 'queued', queued: 1 });
  });
});

describe('absence dedupe keys', () => {
  it('round-trips; anything else is not an absence key', () => {
    expect(parseAbsenceDedupeKey(absenceDedupeKey('s-1', 'st-1'))).toEqual({
      sessionId: 's-1',
      studentId: 'st-1',
    });
    expect(parseAbsenceDedupeKey('fee_reminder:x:y')).toBeNull();
    expect(parseAbsenceDedupeKey('absence:x')).toBeNull();
  });

  it('expiryOf: 10:00 local the day after the class', () => {
    expect(expiryOf(LocalDate.parse('2026-10-19'), 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-20T04:30:00.000Z',
    );
  });
});
