import { AppError, type Clock, type IdGenerator } from '@coachingdesk/shared';
import { Batch, type BatchChanges, type NewBatchInput } from './batch';
import type { BatchRepository, ListBatchesOptions } from './batch.repository';

export interface BatchServiceDeps {
  batches: BatchRepository;
  ids: IdGenerator;
  clock: Clock;
}

/**
 * The public face of the batches module. Every method takes the instituteId FIRST: it comes
 * from currentTenant(request) (a verified membership), never from the URL or body directly.
 * Role checks (owner/staff for writes) are the route guards' job, not this class's.
 */
export class BatchService {
  constructor(private readonly deps: BatchServiceDeps) {}

  async create(instituteId: string, input: NewBatchInput): Promise<Batch> {
    const batch = Batch.create(this.deps.ids.next(), instituteId, input);
    await this.deps.batches.create(batch);
    return batch;
  }

  async list(instituteId: string, options: ListBatchesOptions): Promise<Batch[]> {
    return this.deps.batches.listForInstitute(instituteId, options);
  }

  /** NOT_FOUND for an unknown id AND for another institute's batch: same 404, nothing leaks. */
  async get(instituteId: string, batchId: string): Promise<Batch> {
    const batch = await this.deps.batches.findById(instituteId, batchId);
    if (!batch) {
      throw new AppError('NOT_FOUND', 'Batch not found');
    }
    return batch;
  }

  /** Load, let the entity apply the rules, save. An archived batch -> 409 from the entity. */
  async update(instituteId: string, batchId: string, changes: BatchChanges): Promise<Batch> {
    const updated = (await this.get(instituteId, batchId)).withChanges(changes);
    await this.deps.batches.update(updated);
    return updated;
  }

  /**
   * Idempotent: archiving an archived batch returns it as-is, with no write and no error,
   * so the app can safely retry after a timeout (AGENTS rule 6).
   */
  async archive(instituteId: string, batchId: string): Promise<Batch> {
    const batch = await this.get(instituteId, batchId);
    if (batch.isArchived) {
      return batch;
    }
    const archived = batch.archive(this.deps.clock.now());
    await this.deps.batches.update(archived);
    return archived;
  }
}
