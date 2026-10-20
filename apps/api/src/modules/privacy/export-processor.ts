import type { FileStore } from '@coachingdesk/providers';
import type { Clock } from '@coachingdesk/shared';
import { toCsv } from '../../lib/csv';
import { ZipWriter } from '../../lib/zip-writer';
import type { DataExport, DataExportRepository } from './data-export.repository';
import type { ExportTable, TenantDataSource } from './tenant-data';

export interface ExportProcessorOptions {
  maxAttempts: number;
  /** How long the ZIP is kept for download. */
  keepForMs: number;
  /** 'running' longer than this = the worker died mid-build: try again. */
  stuckAfterMs: number;
  /** Exports built per run (each can take seconds). */
  perRun: number;
}

export const DEFAULT_EXPORT_OPTIONS: ExportProcessorOptions = {
  maxAttempts: 3,
  keepForMs: 7 * 24 * 60 * 60 * 1000,
  stuckAfterMs: 15 * 60 * 1000,
  perRun: 3,
};

export interface ExportRunSummary {
  built: number;
  retried: number;
  failed: number;
  expired: number;
}

const README = (exportedAt: Date, tables: readonly ExportTable[]) =>
  [
    'Your institute data export',
    `Exported at ${exportedAt.toISOString()} (UTC).`,
    '',
    'Files (CSV, UTF-8; open with Excel or Google Sheets):',
    ...tables.map((t) => `- ${t.file}: ${t.rows.length} rows`),
    '',
    'Notes:',
    '- Times end in "Z" and are UTC (India is UTC+05:30). Dates without a time are local.',
    '- Amounts are in rupees. Ids link the files together (e.g. invoices.student_id = students.id).',
    "- A leading ' before =, +, - or @ is added on purpose so spreadsheets don't run it as a formula.",
    '',
  ].join('\r\n');

/**
 * The worker side of exports (FR-7.6): builds the ZIP of CSVs, stores it, and deletes old ones.
 * Safe with several workers: each claim is exclusive (SKIP LOCKED).
 */
export class ExportProcessor {
  private readonly options: ExportProcessorOptions;

  constructor(
    private readonly deps: {
      exports: DataExportRepository;
      source: TenantDataSource;
      files: FileStore;
      clock: Clock;
    },
    options: Partial<ExportProcessorOptions> = {},
  ) {
    this.options = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  }

  async runOnce(): Promise<ExportRunSummary> {
    const summary: ExportRunSummary = { built: 0, retried: 0, failed: 0, expired: 0 };
    for (let i = 0; i < this.options.perRun; i++) {
      const now = this.deps.clock.now();
      const job = await this.deps.exports.claimNext(
        now,
        new Date(now.getTime() - this.options.stuckAfterMs),
      );
      if (!job) {
        break;
      }
      const outcome = await this.build(job);
      summary[outcome] += 1;
      if (outcome !== 'built') {
        break; // something is wrong: try again on the NEXT run, not straight away
      }
    }
    summary.expired = await this.expireOld();
    return summary;
  }

  private async build(job: DataExport): Promise<'built' | 'retried' | 'failed'> {
    try {
      const tables = await this.deps.source.exportTables(job.instituteId);
      const now = this.deps.clock.now();
      const zip = new ZipWriter(now);
      zip.add('README.txt', README(now, tables));
      for (const table of tables) {
        zip.add(table.file, toCsv(table.header, table.rows));
      }
      const data = zip.toBuffer();
      const fileKey = `exports/${job.instituteId}/${job.id}.zip`;
      await this.deps.files.put(fileKey, data, 'application/zip');
      await this.deps.exports.markReady(job.id, {
        fileKey,
        byteSize: data.length,
        readyAt: now,
        expiresAt: new Date(now.getTime() + this.options.keepForMs),
      });
      return 'built';
    } catch {
      // The error itself may quote data (a row value): store only a code (AGENTS rule 9).
      if (job.attempts < this.options.maxAttempts) {
        await this.deps.exports.retryLater(job.id, 'build_failed');
        return 'retried';
      }
      await this.deps.exports.markFailed(job.id, 'build_failed');
      return 'failed';
    }
  }

  /** Deletes the files of exports past their keep date (the row stays, as 'expired'). */
  private async expireOld(): Promise<number> {
    const due = await this.deps.exports.listExpired(this.deps.clock.now(), 50);
    for (const job of due) {
      if (job.fileKey) {
        await this.deps.files.delete(job.fileKey);
      }
      await this.deps.exports.markExpired(job.id);
    }
    return due.length;
  }
}
