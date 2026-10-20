import type { Db } from '@coachingdesk/db';
import { dataExports } from '@coachingdesk/db/schema';
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import {
  type DataExport,
  type DataExportRepository,
  EXPORT_STATUSES,
  type ExportStatus,
  type NewDataExport,
} from './data-export.repository';

type Row = typeof dataExports.$inferSelect;

export class DrizzleDataExportRepository implements DataExportRepository {
  constructor(private readonly db: Db) {}

  async createQueued(input: NewDataExport): Promise<{ created: boolean; export: DataExport }> {
    // The partial unique index (one queued/running per institute) decides, atomically: two
    // taps at once insert ONE row; the other gets "nothing inserted" and reads the winner.
    const [inserted] = await this.db
      .insert(dataExports)
      .values({ ...input, status: 'queued' })
      .onConflictDoNothing({
        target: dataExports.instituteId,
        where: sql`${dataExports.status} in ('queued', 'running')`,
      })
      .returning();
    if (inserted) {
      return { created: true, export: toExport(inserted) };
    }
    const [existing] = await this.db
      .select()
      .from(dataExports)
      .where(
        and(
          eq(dataExports.instituteId, input.instituteId),
          sql`${dataExports.status} in ('queued', 'running')`,
        ),
      );
    if (!existing) {
      // Finished between our insert and select: rare; asking again will work.
      throw new Error('DrizzleDataExportRepository: export in progress vanished; retry');
    }
    return { created: false, export: toExport(existing) };
  }

  async findById(instituteId: string, exportId: string): Promise<DataExport | null> {
    const [row] = await this.db
      .select()
      .from(dataExports)
      .where(and(eq(dataExports.instituteId, instituteId), eq(dataExports.id, exportId)));
    return row ? toExport(row) : null;
  }

  async listForInstitute(instituteId: string, limit: number): Promise<DataExport[]> {
    const rows = await this.db
      .select()
      .from(dataExports)
      .where(eq(dataExports.instituteId, instituteId))
      .orderBy(desc(dataExports.id))
      .limit(limit);
    return rows.map(toExport);
  }

  async countSince(instituteId: string, since: Date): Promise<number> {
    return this.db.$count(
      dataExports,
      and(eq(dataExports.instituteId, instituteId), gte(dataExports.createdAt, since)),
    );
  }

  async claimNext(now: Date, stuckBefore: Date): Promise<DataExport | null> {
    // One statement: pick the oldest candidate with SKIP LOCKED (another worker skips it)
    // and flip it to 'running'. Same claim pattern as the outbox.
    const rows = await this.db.execute<{ id: string }>(sql`
      update ${dataExports}
      set status = 'running', started_at = ${now.toISOString()}::timestamptz,
          attempts = attempts + 1, updated_at = now()
      where id = (
        select id from ${dataExports}
        where status = 'queued'
           or (status = 'running' and started_at < ${stuckBefore.toISOString()}::timestamptz)
        order by created_at
        limit 1
        for update skip locked
      )
      returning id`);
    const id = rows[0]?.id;
    if (!id) {
      return null;
    }
    const [row] = await this.db.select().from(dataExports).where(eq(dataExports.id, id));
    return row ? toExport(row) : null;
  }

  async markReady(
    exportId: string,
    file: { fileKey: string; byteSize: number; readyAt: Date; expiresAt: Date },
  ): Promise<void> {
    await this.db
      .update(dataExports)
      .set({ status: 'ready', error: null, ...file, updatedAt: sql`now()` })
      .where(eq(dataExports.id, exportId));
  }

  async retryLater(exportId: string, error: string): Promise<void> {
    await this.db
      .update(dataExports)
      .set({ status: 'queued', error, updatedAt: sql`now()` })
      .where(eq(dataExports.id, exportId));
  }

  async markFailed(exportId: string, error: string): Promise<void> {
    await this.db
      .update(dataExports)
      .set({ status: 'failed', error, updatedAt: sql`now()` })
      .where(eq(dataExports.id, exportId));
  }

  async listExpired(now: Date, limit: number): Promise<DataExport[]> {
    const rows = await this.db
      .select()
      .from(dataExports)
      .where(
        and(
          eq(dataExports.status, 'ready'),
          isNotNull(dataExports.expiresAt),
          lte(dataExports.expiresAt, now),
        ),
      )
      .orderBy(asc(dataExports.expiresAt))
      .limit(limit);
    return rows.map(toExport);
  }

  async markExpired(exportId: string): Promise<void> {
    await this.db
      .update(dataExports)
      .set({ status: 'expired', fileKey: null, updatedAt: sql`now()` })
      .where(eq(dataExports.id, exportId));
  }
}

function toExport(row: Row): DataExport {
  return {
    id: row.id,
    instituteId: row.instituteId,
    requestedBy: row.requestedBy,
    status: toStatus(row.status),
    fileKey: row.fileKey,
    byteSize: row.byteSize,
    attempts: row.attempts,
    error: row.error,
    startedAt: row.startedAt,
    readyAt: row.readyAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

function toStatus(value: string): ExportStatus {
  if ((EXPORT_STATUSES as readonly string[]).includes(value)) {
    return value as ExportStatus;
  }
  throw new Error(`Unexpected export status in database: ${value}`);
}
