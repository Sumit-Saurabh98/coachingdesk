import type { Db } from '@coachingdesk/db';
import { batches } from '@coachingdesk/db/schema';
import { FEE_CYCLES, type FeeCycle, Money } from '@coachingdesk/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Batch } from './batch';
import { BatchSchedule } from './batch-schedule';
import type { BatchRepository, ListBatchesOptions } from './batch.repository';

type BatchRow = typeof batches.$inferSelect;

export class DrizzleBatchRepository implements BatchRepository {
  constructor(private readonly db: Db) {}

  async create(batch: Batch): Promise<void> {
    await this.db.insert(batches).values({ id: batch.id, ...toColumns(batch) });
  }

  async findById(instituteId: string, batchId: string): Promise<Batch | null> {
    // BOTH conditions: the id alone would find another institute's batch.
    const [row] = await this.db
      .select()
      .from(batches)
      .where(and(eq(batches.instituteId, instituteId), eq(batches.id, batchId)));
    return row ? toBatch(row) : null;
  }

  async listForInstitute(instituteId: string, options: ListBatchesOptions): Promise<Batch[]> {
    const rows = await this.db
      .select()
      .from(batches)
      .where(
        and(
          eq(batches.instituteId, instituteId),
          // undefined = "no extra condition": and() skips it
          options.includeArchived ? undefined : isNull(batches.archivedAt),
        ),
      )
      // id breaks ties: UUIDv7 ids are time-ordered, so it's still "oldest first"
      .orderBy(asc(batches.createdAt), asc(batches.id));
    return rows.map(toBatch);
  }

  async update(batch: Batch): Promise<void> {
    const updated = await this.db
      .update(batches)
      .set(toColumns(batch))
      .where(and(eq(batches.id, batch.id), eq(batches.instituteId, batch.instituteId)))
      .returning({ id: batches.id });
    if (updated.length === 0) {
      throw new Error(
        `DrizzleBatchRepository: no batch ${batch.id} in institute ${batch.instituteId}`,
      );
    }
  }
}

/** Entity -> columns. The value objects are turned back into plain JSON / numbers here. */
function toColumns(batch: Batch) {
  return {
    instituteId: batch.instituteId,
    name: batch.name,
    subject: batch.subject,
    schedule: batch.schedule.toJSON(),
    defaultFeePaise: batch.defaultFee.toPaise(),
    defaultFeeCycle: batch.defaultFeeCycle,
    archivedAt: batch.archivedAt,
  };
}

/** Row -> entity. Building the value objects here is what lets Batch.restore() trust its input. */
function toBatch(row: BatchRow): Batch {
  return Batch.restore({
    id: row.id,
    instituteId: row.instituteId,
    name: row.name,
    subject: row.subject,
    schedule: BatchSchedule.of(row.schedule),
    defaultFee: Money.ofPaise(row.defaultFeePaise),
    defaultFeeCycle: toCycle(row.defaultFeeCycle),
    archivedAt: row.archivedAt,
  });
}

// The DB CHECK constraint guarantees this; the guard turns `string` into the FeeCycle union.
function toCycle(value: string): FeeCycle {
  if ((FEE_CYCLES as readonly string[]).includes(value)) {
    return value as FeeCycle;
  }
  throw new Error(`Unexpected fee cycle in database: ${value}`);
}
