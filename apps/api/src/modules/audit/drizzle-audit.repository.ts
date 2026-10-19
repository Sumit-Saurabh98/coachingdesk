import type { Db } from '@coachingdesk/db';
import { auditLog } from '@coachingdesk/db/schema';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { AuditEntry, AuditRepository } from './audit.repository';

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly db: Db) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLog).values(entry);
  }

  async list(
    instituteId: string,
    query: { limit: number; beforeId?: string },
  ): Promise<AuditEntry[]> {
    const conditions: SQL[] = [eq(auditLog.instituteId, instituteId)];
    if (query.beforeId) conditions.push(lt(auditLog.id, query.beforeId));
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.id))
      .limit(query.limit);
    return rows.map((row) => ({
      ...row,
      before: row.before as Record<string, unknown> | null,
      after: row.after as Record<string, unknown> | null,
    }));
  }
}
