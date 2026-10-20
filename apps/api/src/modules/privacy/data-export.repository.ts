export const EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed', 'expired'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export interface DataExport {
  id: string;
  instituteId: string;
  requestedBy: string | null;
  status: ExportStatus;
  fileKey: string | null;
  byteSize: number | null;
  attempts: number;
  error: string | null;
  startedAt: Date | null;
  readyAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export type NewDataExport = Pick<DataExport, 'id' | 'instituteId' | 'requestedBy' | 'createdAt'>;

export interface DataExportRepository {
  /**
   * Queues an export unless one is already queued/running for the institute (a unique index
   * makes that atomic). Returns the new export, or the one already in progress.
   */
  createQueued(input: NewDataExport): Promise<{ created: boolean; export: DataExport }>;
  findById(instituteId: string, exportId: string): Promise<DataExport | null>;
  /** Newest first. */
  listForInstitute(instituteId: string, limit: number): Promise<DataExport[]>;
  /** How many were requested since `since` (the daily cap). */
  countSince(instituteId: string, since: Date): Promise<number>;
  /**
   * The worker's claim: the oldest queued export, or one stuck in 'running' since before
   * `stuckBefore` (a crashed worker), moves to 'running' with attempts + 1. Never the same
   * export to two workers (SKIP LOCKED).
   */
  claimNext(now: Date, stuckBefore: Date): Promise<DataExport | null>;
  markReady(
    exportId: string,
    file: { fileKey: string; byteSize: number; readyAt: Date; expiresAt: Date },
  ): Promise<void>;
  /** Back to 'queued' for another try. */
  retryLater(exportId: string, error: string): Promise<void>;
  markFailed(exportId: string, error: string): Promise<void>;
  /** Ready exports whose file should be deleted now. */
  listExpired(now: Date, limit: number): Promise<DataExport[]>;
  markExpired(exportId: string): Promise<void>;
}

/** Tests and local dev only. */
export class InMemoryDataExportRepository implements DataExportRepository {
  private readonly rows = new Map<string, DataExport>();

  async createQueued(input: NewDataExport): Promise<{ created: boolean; export: DataExport }> {
    const inProgress = [...this.rows.values()].find(
      (e) => e.instituteId === input.instituteId && isInProgress(e.status),
    );
    if (inProgress) {
      return { created: false, export: { ...inProgress } };
    }
    const row: DataExport = {
      ...input,
      status: 'queued',
      fileKey: null,
      byteSize: null,
      attempts: 0,
      error: null,
      startedAt: null,
      readyAt: null,
      expiresAt: null,
    };
    this.rows.set(row.id, row);
    return { created: true, export: { ...row } };
  }

  async findById(instituteId: string, exportId: string): Promise<DataExport | null> {
    const row = this.rows.get(exportId);
    return row && row.instituteId === instituteId ? { ...row } : null;
  }

  async listForInstitute(instituteId: string, limit: number): Promise<DataExport[]> {
    return [...this.rows.values()]
      .filter((e) => e.instituteId === instituteId)
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async countSince(instituteId: string, since: Date): Promise<number> {
    return [...this.rows.values()].filter(
      (e) => e.instituteId === instituteId && e.createdAt >= since,
    ).length;
  }

  async claimNext(now: Date, stuckBefore: Date): Promise<DataExport | null> {
    const next = [...this.rows.values()]
      .filter(
        (e) =>
          e.status === 'queued' ||
          (e.status === 'running' && e.startedAt !== null && e.startedAt < stuckBefore),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!next) {
      return null;
    }
    Object.assign(next, { status: 'running', startedAt: now, attempts: next.attempts + 1 });
    return { ...next };
  }

  async markReady(
    exportId: string,
    file: { fileKey: string; byteSize: number; readyAt: Date; expiresAt: Date },
  ): Promise<void> {
    this.update(exportId, { status: 'ready', error: null, ...file });
  }

  async retryLater(exportId: string, error: string): Promise<void> {
    this.update(exportId, { status: 'queued', error });
  }

  async markFailed(exportId: string, error: string): Promise<void> {
    this.update(exportId, { status: 'failed', error });
  }

  async listExpired(now: Date, limit: number): Promise<DataExport[]> {
    return [...this.rows.values()]
      .filter((e) => e.status === 'ready' && e.expiresAt !== null && e.expiresAt <= now)
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async markExpired(exportId: string): Promise<void> {
    this.update(exportId, { status: 'expired', fileKey: null });
  }

  /** The purge (in-memory twin of the tenant-data repository) drops an institute's rows. */
  removeInstitute(instituteId: string): void {
    for (const [id, row] of this.rows) {
      if (row.instituteId === instituteId) {
        this.rows.delete(id);
      }
    }
  }

  private update(exportId: string, changes: Partial<DataExport>): void {
    const row = this.rows.get(exportId);
    if (row) {
      Object.assign(row, changes);
    }
  }
}

export function isInProgress(status: ExportStatus): boolean {
  return status === 'queued' || status === 'running';
}
