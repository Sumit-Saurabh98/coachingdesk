import type { Batch } from './batch';

export interface ListBatchesOptions {
  includeArchived: boolean;
}

/**
 * Storage for batches. Every read is scoped to ONE institute (AGENTS rule 1):
 * there is deliberately no findById(batchId) without an instituteId.
 */
export interface BatchRepository {
  /** Stores a new batch. Throws if the id already exists. */
  create(batch: Batch): Promise<void>;
  /** The batch, or null if it doesn't exist IN THIS INSTITUTE (another institute's batch = null). */
  findById(instituteId: string, batchId: string): Promise<Batch | null>;
  /** The institute's batches, oldest first. Archived ones only when asked. */
  listForInstitute(instituteId: string, options: ListBatchesOptions): Promise<Batch[]>;
  /**
   * Saves every editable field, including archivedAt (that's how archive is stored).
   * Matches on id AND batch.instituteId; throws if no such batch exists in that institute.
   */
  update(batch: Batch): Promise<void>;
}

/** Tests and local dev only. */
export class InMemoryBatchRepository implements BatchRepository {
  // A Map keeps insertion order, which gives us "oldest first" for free.
  private readonly batches = new Map<string, Batch>();

  async create(batch: Batch): Promise<void> {
    if (this.batches.has(batch.id)) {
      throw new Error(`InMemoryBatchRepository: batch ${batch.id} already exists`);
    }
    this.batches.set(batch.id, batch);
  }

  async findById(instituteId: string, batchId: string): Promise<Batch | null> {
    const batch = this.batches.get(batchId);
    // The tenancy check: an id from another institute behaves exactly like an unknown id.
    return batch && batch.instituteId === instituteId ? batch : null;
  }

  async listForInstitute(instituteId: string, options: ListBatchesOptions): Promise<Batch[]> {
    return [...this.batches.values()].filter(
      (batch) =>
        batch.instituteId === instituteId && (options.includeArchived || !batch.isArchived),
    );
  }

  async update(batch: Batch): Promise<void> {
    const existing = this.batches.get(batch.id);
    if (!existing || existing.instituteId !== batch.instituteId) {
      throw new Error(
        `InMemoryBatchRepository: no batch ${batch.id} in institute ${batch.instituteId}`,
      );
    }
    this.batches.set(batch.id, batch);
  }
}
