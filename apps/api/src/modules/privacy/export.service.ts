import { AppError, type Clock, type IdGenerator, LocalDate } from '@coachingdesk/shared';
import type { FileStore } from '@coachingdesk/providers';
import type { DataExport, DataExportRepository } from './data-export.repository';

/** Exports are heavy (every row of the institute): a few a day is plenty for a person. */
export const EXPORTS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExportServiceDeps {
  exports: DataExportRepository;
  files: Pick<FileStore, 'get'>;
  ids: IdGenerator;
  clock: Clock;
}

/** FR-7.6: the owner's full data export (the API side; ExportProcessor builds it). */
export class ExportService {
  constructor(private readonly deps: ExportServiceDeps) {}

  /**
   * POST /exports (owner). Returns the new export, or the one already queued/running: a second
   * tap never starts a second export.
   */
  async request(
    instituteId: string,
    userId: string,
  ): Promise<{ created: boolean; export: DataExport }> {
    const now = this.deps.clock.now();
    const recent = await this.deps.exports.countSince(
      instituteId,
      new Date(now.getTime() - DAY_MS),
    );
    if (recent >= EXPORTS_PER_DAY) {
      throw new AppError('DAILY_LIMIT_REACHED', `At most ${EXPORTS_PER_DAY} exports a day`, {
        limit: EXPORTS_PER_DAY,
      });
    }
    return this.deps.exports.createQueued({
      id: this.deps.ids.next(),
      instituteId,
      requestedBy: userId,
      createdAt: now,
    });
  }

  async get(instituteId: string, exportId: string): Promise<DataExport> {
    const found = await this.deps.exports.findById(instituteId, exportId);
    if (!found) {
      throw new AppError('NOT_FOUND', 'Export not found');
    }
    return found;
  }

  async list(instituteId: string, limit: number): Promise<DataExport[]> {
    return this.deps.exports.listForInstitute(instituteId, limit);
  }

  /** GET /exports/:id/download (owner): the ZIP, only while ready and not expired. */
  async download(
    instituteId: string,
    exportId: string,
  ): Promise<{ data: Uint8Array; filename: string }> {
    const found = await this.get(instituteId, exportId);
    const now = this.deps.clock.now();
    if (found.status !== 'ready' || !found.fileKey || (found.expiresAt && found.expiresAt <= now)) {
      throw new AppError('CONFLICT', 'This export is not available for download', {
        status: found.status === 'ready' ? 'expired' : found.status,
      });
    }
    const data = await this.deps.files.get(found.fileKey);
    if (!data) {
      throw new AppError('CONFLICT', 'This export is not available for download', {
        status: 'expired',
      });
    }
    const day = LocalDate.fromInstant(found.createdAt, 'Asia/Kolkata');
    return { data, filename: `coachingdesk-export-${day.toString()}.zip` };
  }
}
