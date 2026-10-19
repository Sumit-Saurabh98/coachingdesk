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

function renderer(students: Student[], dues: Due[]) {
  return new FeeReminderRenderer(
    { activeByGuardianPhone: async () => students },
    { openForStudents: async (_i, ids) => dues.filter((d) => ids.includes(d.studentId)) },
    { get: async () => ({ name: 'Sharma Classes' }) },
  );
}

const aarav = { id: 'a', name: 'Aarav', guardianName: 'Neha Sharma' };
const bhavya = { id: 'b', name: 'Bhavya', guardianName: null };

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

  it('no guardian name on file: "Parent"', async () => {
    const result = await renderer([bhavya], [due('b', 800, '2026-10-07')]).check(message);
    expect(result).toMatchObject({ params: { guardian: 'Parent' } });
  });
});
