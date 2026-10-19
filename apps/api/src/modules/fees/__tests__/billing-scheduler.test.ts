import { describe, expect, it } from 'vitest';
import { LocalDate } from '@coachingdesk/shared';
import { BillingScheduler } from '../billing-scheduler';

describe('BillingScheduler.runOnce', () => {
  it('runs every active institute; one failure does not stop the others', async () => {
    const calls: string[] = [];
    const scheduler = new BillingScheduler(
      { listActive: async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      {
        runDue: async (id) => {
          calls.push(id);
          if (id === 'b') throw new Error('db hiccup');
          if (id === 'c') return null; // already billed this period
          return {
            periodStart: LocalDate.parse('2026-10-01'),
            created: 3,
            alreadyBilled: 0,
            skipped: 1,
          };
        },
      },
    );

    const summary = await scheduler.runOnce();

    expect(calls).toEqual(['a', 'b', 'c']);
    expect(summary).toEqual({
      institutes: 3,
      billed: 1,
      invoicesCreated: 3,
      failed: [{ instituteId: 'b', error: 'Error: db hiccup' }],
    });
  });
});
