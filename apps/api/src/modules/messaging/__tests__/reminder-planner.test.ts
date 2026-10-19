import { describe, expect, it } from 'vitest';
import {
  type FeatureKey,
  FixedClock,
  LocalDate,
  PhoneNumber,
  SequentialIdGenerator,
} from '@coachingdesk/shared';
import { InMemoryOutboxRepository } from '../outbox.repository';
import { feeReminderKey, ReminderPlanner, ReminderScheduler } from '../reminder-planner';

const A = 'inst-a';
const NEHA = PhoneNumber.parse('9812345678');
const RAVI = PhoneNumber.parse('9123456789');
// Today at the institute: 2026-10-19 (15:30 IST).
const NOW = new Date('2026-10-19T10:00:00Z');

type Invoice = { studentId: string; dueDate: string };

function setup(
  options: { invoices?: Invoice[]; offsets?: number[]; features?: FeatureKey[]; now?: Date } = {},
) {
  const outbox = new InMemoryOutboxRepository();
  const students = [
    { id: 'aarav', isActive: true, guardianPhone: NEHA },
    { id: 'bhavya', isActive: true, guardianPhone: NEHA }, // Aarav's sister
    { id: 'chirag', isActive: true, guardianPhone: RAVI },
    { id: 'leaver', isActive: false, guardianPhone: RAVI },
  ];
  const invoices = options.invoices ?? [];
  const planner = new ReminderPlanner({
    outbox,
    institutes: {
      get: async () => ({
        timezone: 'Asia/Kolkata',
        settings: { reminderOffsets: options.offsets ?? [3, 0, -3, -7], messageLanguage: 'hi' },
      }),
    },
    entitlements: {
      get: async () => ({ features: new Set(options.features ?? ['automatic_messages']) }),
    },
    invoices: {
      openDueOn: async (_i, dates) =>
        invoices.filter((inv) => dates.some((d) => d.toString() === inv.dueDate)),
    },
    students: { findByIds: async (_i, ids) => students.filter((s) => ids.includes(s.id)) },
    ids: new SequentialIdGenerator(),
    clock: new FixedClock(options.now ?? NOW),
  });
  return { planner, outbox };
}

describe('ReminderPlanner.planFor', () => {
  it('reminds on the offsets: 3 days before, on the day, 3 and 7 days after', async () => {
    const { planner } = setup({
      invoices: [
        { studentId: 'aarav', dueDate: '2026-10-22' }, // in 3 days: yes
        { studentId: 'chirag', dueDate: '2026-10-12' }, // 7 days late: yes
      ],
    });
    expect(await planner.planFor(A)).toEqual({ guardians: 2, queued: 2 });

    const notOnOffset = setup({ invoices: [{ studentId: 'aarav', dueDate: '2026-10-20' }] });
    expect(await notOnOffset.planner.planFor(A)).toEqual({ guardians: 0, queued: 0 });
  });

  it('siblings get ONE reminder; a re-run the same day queues nothing new', async () => {
    const { planner, outbox } = setup({
      invoices: [
        { studentId: 'aarav', dueDate: '2026-10-19' },
        { studentId: 'bhavya', dueDate: '2026-10-22' },
      ],
    });

    expect(await planner.planFor(A)).toEqual({ guardians: 1, queued: 1 });
    expect(await planner.planFor(A)).toEqual({ guardians: 1, queued: 0 });

    const queued = await outbox.findByDedupeKey(
      feeReminderKey(A, NEHA, LocalDate.parse('2026-10-19')),
    );
    expect(queued).toMatchObject({
      category: 'fee_reminder',
      priority: 3,
      locale: 'hi',
      expiresAt: new Date('2026-10-20T15:30:00Z'), // 21:00 IST tomorrow
    });
  });

  it('students who left get no reminders', async () => {
    const { planner } = setup({ invoices: [{ studentId: 'leaver', dueDate: '2026-10-19' }] });
    expect(await planner.planFor(A)).toEqual({ guardians: 0, queued: 0 });
  });

  it('nothing on Free (no automatic messages) or with reminders turned off', async () => {
    const invoices = [{ studentId: 'aarav', dueDate: '2026-10-19' }];
    expect(await setup({ invoices, features: [] }).planner.planFor(A)).toEqual({
      guardians: 0,
      queued: 0,
    });
    expect(await setup({ invoices, offsets: [] }).planner.planFor(A)).toEqual({
      guardians: 0,
      queued: 0,
    });
  });

  it("uses the institute's date: at 23:30 UTC on Oct 18 it is already Oct 19 in India", async () => {
    const { planner } = setup({
      invoices: [{ studentId: 'aarav', dueDate: '2026-10-19' }],
      now: new Date('2026-10-18T19:00:00Z'),
    });
    expect((await planner.planFor(A)).queued).toBe(1);
  });
});

describe('ReminderScheduler.runOnce', () => {
  it('plans every institute; one failure does not stop the rest', async () => {
    const scheduler = new ReminderScheduler(
      { listActive: async () => [{ id: 'a' }, { id: 'b' }] },
      {
        planFor: async (id) => {
          if (id === 'a') throw new Error('db hiccup');
          return { queued: 4 };
        },
      },
    );
    expect(await scheduler.runOnce()).toEqual({
      institutes: 2,
      queued: 4,
      failed: [{ instituteId: 'a', error: 'Error: db hiccup' }],
    });
  });
});
