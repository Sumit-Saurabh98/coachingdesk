import { describe, expect, it } from 'vitest';
import { FixedClock, LocalDate, PhoneNumber, SequentialIdGenerator } from '@coachingdesk/shared';
import { InMemoryBatchRepository } from '../../batches/batch.repository';
import { BatchService } from '../../batches/batch.service';
import { InMemoryEnrollmentRepository } from '../../enrollments/enrollment.repository';
import { EnrollmentService } from '../../enrollments/enrollment.service';
import { InMemoryStudentRepository } from '../../students/student.repository';
import { StudentService } from '../../students/student.service';
import type { AbsenceAlerts } from '../absence-alerts';
import { AttendanceWindow } from '../attendance-window';
import { InMemoryAttendanceRepository } from '../attendance.repository';
import { AttendanceService } from '../attendance.service';

const A = 'inst-a';
const B = 'inst-b';
const day = (text: string) => LocalDate.parse(text);
const TODAY = '2026-10-19'; // a Monday (15:30 IST)

async function setup() {
  const ids = new SequentialIdGenerator();
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const institutes = { get: async () => ({ timezone: 'Asia/Kolkata' }) };
  const students = new StudentService({
    students: new InMemoryStudentRepository(),
    entitlements: { limitFor: async () => null },
    institutes,
    ids,
    clock,
  });
  const batches = new BatchService({ batches: new InMemoryBatchRepository(), ids, clock });
  const enrollments = new EnrollmentService({
    enrollments: new InMemoryEnrollmentRepository(),
    students,
    batches,
    institutes,
    ids,
    clock,
  });
  const alertCalls: number[] = [];
  const alerts: AbsenceAlerts = {
    afterSync: async ({ records }) => {
      alertCalls.push(records.length);
      return { status: 'queued', queued: records.filter((r) => r.status === 'absent').length };
    },
  };
  const service = new AttendanceService({
    attendance: new InMemoryAttendanceRepository(),
    batches,
    enrollments,
    students,
    institutes,
    alerts,
    window: new AttendanceWindow(7),
    ids,
    clock,
  });

  // Monday/Wednesday batch with Aarav + Bhavya enrolled since Oct 1; Chirag joins Oct 20.
  const batch = await batches.create(A, {
    name: 'Maths',
    schedule: { days: [1, 3], start: '17:00', end: '18:00' },
    defaultFeePaise: 0,
    defaultFeeCycle: 'none',
  });
  const add = async (name: string, joinedOn: string) => {
    const s = await students.create(A, {
      name,
      guardianPhone: PhoneNumber.parse('9876543210'),
      joinedOn: day(joinedOn),
    });
    await enrollments.enroll(A, { studentId: s.id, batchId: batch.id, startDate: day(joinedOn) });
    return s;
  };
  const aarav = await add('Aarav', '2026-10-01');
  const bhavya = await add('Bhavya', '2026-10-01');
  const chirag = await add('Chirag', '2026-10-20');
  return { service, batches, batch, aarav, bhavya, chirag, alertCalls, clock };
}

describe('AttendanceService.sync', () => {
  it('stores the marks and asks for absence alerts once per sync', async () => {
    const { service, batch, aarav, bhavya, alertCalls } = await setup();

    const result = await service.sync(A, 'user-1', 'client-1', {
      batchId: batch.id,
      date: day(TODAY),
      records: [
        { studentId: aarav.id, status: 'present' },
        { studentId: bhavya.id, status: 'absent' },
      ],
    });

    expect(result.records.map((r) => r.status).sort()).toEqual(['absent', 'present']);
    expect(result.alerts).toEqual({ status: 'queued', queued: 1 });
    expect(alertCalls).toEqual([2]);
  });

  it('422 for a student not enrolled on that date (Chirag joins tomorrow)', async () => {
    const { service, batch, chirag } = await setup();
    await expect(
      service.sync(A, 'user-1', 'client-1', {
        batchId: batch.id,
        date: day(TODAY),
        records: [{ studentId: chirag.id, status: 'present' }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'records', studentIds: [chirag.id] },
    });
  });

  it.each(['2026-10-21', '2026-10-11'])('422 outside the edit window (%s)', async (date) => {
    const { service, batch, aarav } = await setup();
    await expect(
      service.sync(A, 'user-1', 'client-1', {
        batchId: batch.id,
        date: day(date),
        records: [{ studentId: aarav.id, status: 'present' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'date' } });
  });

  it("404 for another institute's batch; 409 for an archived batch", async () => {
    const { service, batches, batch, aarav } = await setup();
    const request = {
      batchId: batch.id,
      date: day(TODAY),
      records: [{ studentId: aarav.id, status: 'present' as const }],
    };
    await expect(service.sync(B, 'user-1', 'client-1', request)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await batches.archive(A, batch.id);
    await expect(service.sync(A, 'user-1', 'client-1', request)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('409 when a clientId is reused for another date', async () => {
    const { service, batch, aarav } = await setup();
    const records = [{ studentId: aarav.id, status: 'present' as const }];
    await service.sync(A, 'u', 'client-1', { batchId: batch.id, date: day(TODAY), records });
    await expect(
      service.sync(A, 'u', 'client-1', { batchId: batch.id, date: day('2026-10-14'), records }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('AttendanceService.register', () => {
  it('before attendance: everyone enrolled that day, default present, not marked', async () => {
    const { service, batch } = await setup();

    const register = await service.register(A, batch.id, day(TODAY));

    expect(register.session).toBeNull();
    expect(register.students.map((s) => [s.name, s.status, s.marked])).toEqual([
      ['Aarav', 'present', false],
      ['Bhavya', 'present', false],
    ]);
  });

  it('after a partial sync: the marked ones show their mark', async () => {
    const { service, batch, bhavya } = await setup();
    await service.sync(A, 'u', 'client-1', {
      batchId: batch.id,
      date: day(TODAY),
      records: [{ studentId: bhavya.id, status: 'absent' }],
    });

    const register = await service.register(A, batch.id, day(TODAY));

    expect(register.session).not.toBeNull();
    expect(register.students.map((s) => [s.name, s.status, s.marked])).toEqual([
      ['Aarav', 'present', false],
      ['Bhavya', 'absent', true],
    ]);
  });

  it('the next day includes Chirag (enrolled from Oct 20)', async () => {
    const { service, batch } = await setup();
    const register = await service.register(A, batch.id, day('2026-10-20'));
    expect(register.students.map((s) => s.name)).toEqual(['Aarav', 'Bhavya', 'Chirag']);
  });
});

describe('AttendanceService.studentHistory / daySummary', () => {
  it("a student's marks with counts and percentage", async () => {
    const { service, batch, aarav } = await setup();
    for (const [date, status] of [
      ['2026-10-12', 'present'],
      ['2026-10-14', 'absent'],
      ['2026-10-19', 'late'],
    ] as const) {
      await service.sync(A, 'u', `client-${date}`, {
        batchId: batch.id,
        date: day(date),
        records: [{ studentId: aarav.id, status }],
      });
    }

    const history = await service.studentHistory(A, aarav.id, day('2026-10-01'), day('2026-10-31'));

    expect(history.marks.map((m) => m.status)).toEqual(['present', 'absent', 'late']);
    expect(history.stats.toJSON()).toMatchObject({
      present: 1,
      absent: 1,
      late: 1,
      percentage: 67,
    });
    await expect(
      service.studentHistory(B, aarav.id, day('2026-10-01'), day('2026-10-31')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("today's batches: taken or not, with counts", async () => {
    const { service, batches, batch, bhavya } = await setup();
    // A Tuesday-only batch does NOT appear on Monday.
    await batches.create(A, {
      name: 'Science',
      schedule: { days: [2], start: '16:00', end: '17:00' },
      defaultFeePaise: 0,
      defaultFeeCycle: 'none',
    });

    const before = await service.daySummary(A);
    await service.sync(A, 'u', 'client-1', {
      batchId: batch.id,
      date: day(TODAY),
      records: [{ studentId: bhavya.id, status: 'absent' }],
    });
    const after = await service.daySummary(A);

    expect(before.date.toString()).toBe(TODAY);
    expect(before.batches.map((b) => [b.name, b.taken])).toEqual([['Maths', false]]);
    expect(after.batches[0]).toMatchObject({
      taken: true,
      counts: { present: 0, absent: 1, late: 0, leave: 0 },
    });
  });
});
