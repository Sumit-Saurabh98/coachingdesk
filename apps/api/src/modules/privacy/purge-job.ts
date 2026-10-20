import type { FileStore } from '@coachingdesk/providers';
import type { Clock } from '@coachingdesk/shared';
import { DELETION_UNDO_DAYS } from '../institutes/institute';
import type { TenantPurge } from './tenant-data';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeSummary {
  purged: number;
  notDue: number; // cancelled at the last moment
  failed: number;
}

/**
 * FR-7.7: 30 days after an institute's deletion request, everything it had is deleted.
 * Run by the worker (RETENTION_POLL_MS). Safe to run twice or on two workers at once: the
 * purge re-checks under a row lock, and deleting nothing is fine.
 */
export class PurgeJob {
  constructor(
    private readonly deps: {
      tenantData: TenantPurge;
      files: Pick<FileStore, 'delete'>;
      clock: Clock;
    },
    private readonly batchSize = 10,
  ) {}

  async runOnce(): Promise<PurgeSummary> {
    const now = this.deps.clock.now();
    const cutoff = new Date(now.getTime() - DELETION_UNDO_DAYS * DAY_MS);
    const summary: PurgeSummary = { purged: 0, notDue: 0, failed: 0 };
    for (const instituteId of await this.deps.tenantData.listDueForPurge(cutoff, this.batchSize)) {
      try {
        // Files first: if the transaction then fails, the next run deletes the rows; the
        // other order could leave files nobody can find any more.
        for (const key of await this.deps.tenantData.exportFileKeys(instituteId)) {
          await this.deps.files.delete(key);
        }
        const outcome = await this.deps.tenantData.purge(instituteId, cutoff, now);
        summary[outcome === 'purged' ? 'purged' : 'notDue'] += 1;
      } catch {
        summary.failed += 1; // one institute's problem never blocks the others
      }
    }
    return summary;
  }
}
