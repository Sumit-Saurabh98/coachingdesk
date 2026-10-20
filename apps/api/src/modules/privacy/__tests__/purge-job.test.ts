import { describe, expect, it } from 'vitest';
import { FixedClock } from '@coachingdesk/shared';
import { PurgeJob } from '../purge-job';
import type { TenantPurge } from '../tenant-data';

describe('PurgeJob', () => {
  it('cut-off = now - 30 days; one failing institute never blocks the others', async () => {
    const calls: string[] = [];
    let cutoffSeen: Date | null = null;
    const tenantData: TenantPurge = {
      listDueForPurge: async (cutoff) => {
        cutoffSeen = cutoff;
        return ['broken', 'ok', 'cancelled'];
      },
      exportFileKeys: async (instituteId) => [`exports/${instituteId}/e.zip`],
      purge: async (instituteId) => {
        if (instituteId === 'broken') throw new Error('db down');
        return instituteId === 'ok' ? 'purged' : 'not_due';
      },
    };
    const job = new PurgeJob({
      tenantData,
      files: { delete: async (key) => void calls.push(key) },
      clock: new FixedClock(new Date('2026-11-20T10:00:00Z')),
    });

    expect(await job.runOnce()).toEqual({ purged: 1, notDue: 1, failed: 1 });
    expect(cutoffSeen).toEqual(new Date('2026-10-21T10:00:00Z'));
    expect(calls).toEqual(['exports/broken/e.zip', 'exports/ok/e.zip', 'exports/cancelled/e.zip']);
  });
});
