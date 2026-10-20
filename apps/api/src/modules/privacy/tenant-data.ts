import type { CsvCell } from '../../lib/csv';

/** One CSV file of an export: its name, header row and rows. */
export interface ExportTable {
  file: string; // e.g. "students.csv"
  header: readonly string[];
  rows: ReadonlyArray<readonly CsvCell[]>;
}

/**
 * ALL of one institute's data, across every module's tables (KB #44). This is the one
 * documented exception to AGENTS rule 12: an export and a purge are, by definition, about every
 * table at once, and a purge must be ONE transaction. Read-only for export, delete-only for
 * purge; every tenant table must be listed (a test reads the schema and fails otherwise).
 */
export interface TenantDataSource {
  exportTables(instituteId: string): Promise<ExportTable[]>;
}

/** The purge job's side of the same repository (KB #44). */
export interface TenantPurge {
  /** Institutes whose deletion was requested on or before `cutoff` and are not purged yet. */
  listDueForPurge(cutoff: Date, limit: number): Promise<string[]>;
  /** File keys of the institute's exports (deleted from the file store before the rows go). */
  exportFileKeys(instituteId: string): Promise<string[]>;
  /**
   * ONE transaction: re-checks "still requested on or before cutoff" under a row lock (a
   * last-second cancel wins or loses cleanly), deletes every tenant row, leaves a tombstone.
   */
  purge(instituteId: string, cutoff: Date, now: Date): Promise<'purged' | 'not_due'>;
}
