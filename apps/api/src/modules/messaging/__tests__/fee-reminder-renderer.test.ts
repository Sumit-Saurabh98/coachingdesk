import { describe, expect, it } from 'vitest';
import { LocalDate, Money, PhoneNumber } from '@coachingdesk/shared';
import { FeeReminderRenderer } from '../fee-reminder-renderer';
import type { OutboxMessage } from '../outbox.repository';

const message = {
  instituteId: 'inst-1',
  to: PhoneNumber.parse('9812345678'),
} as OutboxMessage;

type Student = { id: string; name: string; guardianName: string | null };
type Due = { studentId: string; remaining: Money; dueDate: LocalDate };
const due = (studentId: string, rupees: number, date: string): Due => ({
  studentId,
  remaining: Money.ofPaise(rupees * 100),
  dueDate: LocalDate.parse(date),
});

function renderer(
  students: Student[],
  dues: Due[],
  ownNumberOf: Student[] = [],
  reminderUpiId: string | null = null,
) {
  return new FeeReminderRenderer(
    { activeByGuardianPhone: async () => students, activeByStudentPhone: async () => ownNumberOf },
    { openForStudents: async (_i, ids) => dues.filter((d) => ids.includes(d.studentId)) },
    { get: async () => ({ name: 'Sharma Classes', reminderUpiId }) },
  );
}

const aarav = { id: 'a', name: 'Aarav', guardianName: 'Neha Sharma' };
const bhavya = { id: 'b', name: 'Bhavya', guardianName: null };

describe('FeeReminderRenderer: the UPI line (FR-7.5)', () => {
  it('one child, UPI line on: fee_reminder_upi with the UPI ID', async () => {
    const result = await renderer(
      [aarav],
      [due('a', 1500, '2026-10-07')],
      [],
      'sharma@okaxis',
    ).check(message);
    expect(result).toEqual({
      kind: 'send',
      template: 'fee_reminder_upi',
      params: {
        guardian: 'Neha Sharma',
        student: 'Aarav',
        amount: '1,500',
        institute: 'Sharma Classes',
        date: '7 Oct 2026',
        upi: 'sharma@okaxis',
      },
    });
  });

  it('siblings, UPI line on: fee_reminder_multi_upi with the UPI ID', async () => {
    const result = await renderer(
      [aarav, bhavya],
      [due('a', 1500, '2026-10-07'), due('b', 1000, '2026-10-07')],
      [],
      'sharma@okaxis',
    ).check(message);
    expect(result).toMatchObject({
      kind: 'send',
      template: 'fee_reminder_multi_upi',
      params: { total: '2,500', upi: 'sharma@okaxis' },
    });
  });

  it('nothing due: still skipped, UPI line or not', async () => {
    const result = await renderer([aarav], [], [], 'sharma@okaxis').check(message);
    expect(result).toEqual({ kind: 'skip', reason: 'nothing_due' });
  });
});

describe('FeeReminderRenderer', () => {
  it('one child: fee_reminder with the total and the oldest due date', async () => {
    const result = await renderer(
      [aarav],
      [due('a', 1500, '2026-10-07'), due('a', 1200.5, '2026-09-07')],
    ).check(message);
    expect(result).toEqual({
      kind: 'send',
      template: 'fee_reminder',
      params: {
        guardian: 'Neha Sharma',
        student: 'Aarav',
        amount: '2,700.50',
        institute: 'Sharma Classes',
        date: '7 Sept 2026',
      },
    });
  });

  it('siblings: ONE fee_reminder_multi with the combined total', async () => {
    const result = await renderer(
      [aarav, bhavya],
      [due('a', 1500, '2026-10-07'), due('b', 800, '2026-10-07')],
    ).check(message);
    expect(result).toEqual({
      kind: 'send',
      template: 'fee_reminder_multi',
      params: {
        guardian: 'Neha Sharma',
        total: '2,300',
        students: 'Aarav and Bhavya',
        institute: 'Sharma Classes',
      },
    });
  });

  it('a sibling with nothing due is not named', async () => {
    const result = await renderer([aarav, bhavya], [due('b', 800, '2026-10-07')]).check(message);
    expect(result).toMatchObject({
      template: 'fee_reminder',
      params: { student: 'Bhavya', guardian: 'Neha Sharma' },
    });
  });

  it('everything paid meanwhile (or only left students): skipped as nothing_due', async () => {
    expect(await renderer([aarav], []).check(message)).toEqual({
      kind: 'skip',
      reason: 'nothing_due',
    });
    expect(await renderer([], [due('a', 1500, '2026-10-07')]).check(message)).toEqual({
      kind: 'skip',
      reason: 'nothing_due',
    });
  });

  it("a student's OWN number: only their dues, greeted by their own name (KB #50)", async () => {
    const result = await renderer(
      [], // nobody's guardian number
      [due('a', 1500, '2026-10-07'), due('b', 800, '2026-10-07')],
      [aarav],
    ).check(message);
    expect(result).toEqual({
      kind: 'send',
      template: 'fee_reminder',
      params: {
        guardian: 'Aarav',
        student: 'Aarav',
        amount: '1,500',
        institute: 'Sharma Classes',
        date: '7 Oct 2026',
      },
    });
  });

  it('no guardian name on file: "Parent"', async () => {
    const result = await renderer([bhavya], [due('b', 800, '2026-10-07')]).check(message);
    expect(result).toMatchObject({ params: { guardian: 'Parent' } });
  });
});
