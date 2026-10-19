export interface AuditEntry {
  id: string;
  instituteId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AuditRepository {
  record(entry: AuditEntry): Promise<void>;
  /** Newest first; ids are UUIDv7 (time-ordered), so paging is by id. */
  list(instituteId: string, query: { limit: number; beforeId?: string }): Promise<AuditEntry[]>;
}

/** Tests and local dev only. */
export class InMemoryAuditRepository implements AuditRepository {
  readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push({ ...entry });
  }

  async list(
    instituteId: string,
    query: { limit: number; beforeId?: string },
  ): Promise<AuditEntry[]> {
    return this.entries
      .filter((e) => e.instituteId === instituteId && (!query.beforeId || e.id < query.beforeId))
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, query.limit);
  }
}
